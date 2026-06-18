#!/usr/bin/env node
// publish-convex-app.mjs — publish a built static site to <deployment>.convex.app
// through the anteater hosting gateway (which moderates, then forwards to chef).
//
//   build → zip (index.html at zip root) → POST anteater /hosting/deploy
//
// Runs in the generated app's directory. Requires a CLOUD Convex deployment
// (anonymous/local deployments can't be hosted) and that you're logged in
// (npx convex login) or have CONVEX_DEPLOY_KEY set.
//
// Config (env, all optional):
//   QB_HOSTING_GATEWAY  gateway origin (default https://basic-anteater-667.convex.site)
//   QB_DIST             build output dir (default: auto-detect out/ | dist/ | build/)
//   CONVEX_DEPLOY_KEY   token; else falls back to ~/.convex/config.json access token
//   QB_SKIP_BUILD=1     skip `npm run build` (zip an already-built dir)
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { zipSync } from "fflate";

const GATEWAY =
  (process.env.QB_HOSTING_GATEWAY || "https://basic-anteater-667.convex.site").replace(/\/+$/, "");

function readEnvLocal() {
  const out = {};
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "").trim();
    }
  }
  return out;
}

function deploymentNameFrom(env) {
  const url = env.NEXT_PUBLIC_CONVEX_URL || env.VITE_CONVEX_URL || env.CONVEX_URL;
  if (url) {
    try {
      return new URL(url).hostname.split(".")[0];
    } catch {}
  }
  const dep = env.CONVEX_DEPLOYMENT || process.env.CONVEX_DEPLOYMENT;
  if (dep) return dep.replace(/^(dev|prod):/, "").trim();
  return null;
}

function resolveToken() {
  if (process.env.CONVEX_DEPLOY_KEY) return process.env.CONVEX_DEPLOY_KEY;
  const cfg = join(homedir(), ".convex", "config.json");
  if (existsSync(cfg)) {
    try {
      const t = JSON.parse(readFileSync(cfg, "utf8")).accessToken;
      if (t) return t;
    } catch {}
  }
  return null;
}

function detectDist() {
  if (process.env.QB_DIST) return process.env.QB_DIST;
  for (const d of ["out", "dist", "build"]) {
    if (existsSync(join(d, "index.html"))) return d;
  }
  return null;
}

function collect(dir, base = dir, acc = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, base, acc);
    else acc[relative(base, p).split(sep).join("/")] = new Uint8Array(readFileSync(p));
  }
  return acc;
}

async function main() {
  const env = readEnvLocal();
  const deploymentName = deploymentNameFrom(env);
  const token = resolveToken();

  if (!deploymentName) {
    console.error("✖ Could not determine deployment name (need NEXT_PUBLIC_CONVEX_URL / CONVEX_DEPLOYMENT in .env.local).");
    console.error("  Publishing needs a CLOUD Convex deployment — run `npx convex dev` and pick a cloud project first.");
    process.exit(1);
  }
  if (!token) {
    console.error("✖ No token. Run `npx convex login` or set CONVEX_DEPLOY_KEY.");
    process.exit(1);
  }

  if (process.env.QB_SKIP_BUILD !== "1") {
    console.log("• Building static export (npm run build)…");
    execSync("npm run build", { stdio: "inherit" });
  }

  const dist = detectDist();
  if (!dist) {
    console.error("✖ No build output with index.html found (looked in out/, dist/, build/).");
    console.error("  For Next.js, set `output: \"export\"` in next.config so it emits out/.");
    process.exit(1);
  }

  const files = collect(dist);
  if (!files["index.html"]) {
    console.error(`✖ ${dist}/index.html missing — the zip root must contain index.html.`);
    process.exit(1);
  }
  const zip = zipSync(files);
  console.log(`• Zipped ${Object.keys(files).length} files from ${dist}/ (${zip.length} bytes)`);

  const url = `${GATEWAY}/hosting/deploy?deploymentName=${encodeURIComponent(deploymentName)}`;
  console.log(`• Uploading to gateway: ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" },
    body: zip,
  });
  const body = await res.json().catch(() => ({}));

  if (res.status === 403 && body?.verdict) {
    console.error("✖ Blocked by content moderation:");
    for (const r of body.verdict.reasons || []) console.error(`   - ${r}`);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`✖ Deploy failed (${res.status}): ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`\n✓ Live at https://${deploymentName}.convex.app\n`);
}

main().catch((e) => {
  console.error("✖", e?.message || e);
  process.exit(1);
});
