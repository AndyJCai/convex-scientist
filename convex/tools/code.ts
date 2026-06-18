import { z } from "zod";
import { createTool, type ToolCtx } from "@convex-dev/agent";
import { SandboxRunner, type SandboxProvider } from "@convex-dev/sandbox";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * code — runs agent-emitted code in an isolated remote sandbox, can load
 * a task's uploaded data files into that sandbox first, and captures any
 * chart/figure files the code writes so the chat UI can show them inline AND
 * records them as generated artifacts so they appear in the Drive.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE FILE = ONE TOOL
 * ──────────────────────────────────────────────────────────────────────────
 * This is the harness's code-execution tool. The agent emits a self-contained
 * snippet (default Python); we run it in a Daytona / Fly Sprites sandbox via
 * the @convex-dev/sandbox component and return the code together with its
 * stdout/stderr/result so both the model and the UI can read the run.
 *
 * UPLOADED FILES — when the agent passes `artifactName` (and/or
 * `artifactNames`), we resolve those files for the CURRENT thread's task
 * (ToolCtx carries threadId + userId; we map threadId → task), fetch their
 * bytes from Convex file storage, and STAGE them into the sandbox at
 * `/tmp/aiscientist/<name>` BEFORE the code runs. The model's code then reads
 * them from that absolute path (e.g. `open("/tmp/aiscientist/data.csv")`).
 * `/tmp/aiscientist` is used because the sandbox user cannot create
 * `/workspace` (its parent `/` is not writable). Files are
 * delivered with `SandboxRunner.createSandbox({ files })` (base64-staged into
 * the sandbox), then `runCode` runs against that same sandbox.
 *
 * IMAGE CAPTURE — the @convex-dev/sandbox component does NOT surface arbitrary
 * files the code writes: `runCode`'s return only exposes stdout/stderr/result
 * plus an opaque, provider-specific `artifacts.charts` array (Daytona-only, and
 * only populated by interactive display hooks like `plt.show()`, not by writing
 * files). So to reliably capture figures across providers we instead SCAN the
 * filesystem ourselves: we keep the sandbox alive after `runCode`
 * (`deleteSandboxAfter: false`), `runCommand` a `find` over `/tmp/aiscientist`
 * for image files, `base64`-read each, store the bytes in Convex file storage,
 * and return their signed URLs. The sandbox is torn down in `finally`. The
 * model is told to SAVE figures to `/tmp/aiscientist` (e.g.
 * `plt.savefig('/tmp/aiscientist/p.png')`) rather than call `plt.show()`.
 *
 * NEVER run agent-emitted code in the Convex trust boundary — that's the whole
 * point of the sandbox component.
 *
 * CONFIG (read from Convex deployment env vars — set on the deployment, never
 * shipped to the client):
 *   • SANDBOX_PROVIDER  — "daytona" (default) | "sprites"
 *   • DAYTONA_API_KEY   — Daytona token (or DAYTONA_JWT_TOKEN + DAYTONA_ORGANIZATION_ID)
 *   • SPRITES_TOKEN     — Fly Sprites token (only when SANDBOX_PROVIDER="sprites")
 * If no key is configured (or anything errors — missing file, run failure), we
 * return a graceful { ..., error } result rather than throwing — a failed
 * analysis must NOT kill the agent turn. Image capture is best-effort: a
 * capture failure never fails the run, it just yields no `images`.
 *
 * CRITICAL — keep this output shape stable; the frontend code-exec card renders it:
 *   { kind: "code-exec", language, code, stdout, stderr, result?, error?, loaded?, images? }
 * (`code` is echoed back so the UI can show exactly what ran; `loaded` lists the
 * artifact names actually staged into the sandbox; `images` is the captured
 * figures as `{ url, alt }` for inline display.)
 */

export type CodeExecResult = {
  kind: "code-exec";
  language: string;
  /** The exact code that was sent to the sandbox, echoed for the UI. */
  code: string;
  stdout: string;
  stderr: string;
  /** Captured trailing result value from the sandbox, when present. */
  result?: string;
  /** Present only on a graceful failure (no key, missing file, or run threw). */
  error?: string;
  /** Names of uploaded artifacts staged into the sandbox before the run. */
  loaded?: string[];
  /**
   * Chart/figure files the executed code wrote to `/tmp/aiscientist`, captured into
   * Convex file storage and surfaced as signed URLs for inline display. Omitted
   * when the code produced no images.
   */
  images?: Array<{ url: string; alt?: string }>;
};

/** Cap how long a single analysis may run in the sandbox (ms). */
const RUN_TIMEOUT_MS = 120_000;

/** Cap how long the image-capture shell commands may run (ms). */
const CAPTURE_TIMEOUT_MS = 60_000;

/**
 * Directory inside the sandbox where uploaded files are staged AND where the
 * model is told to save figures. Must be world-writable: the sandbox user
 * cannot create `/workspace` (its parent `/` is not writable, so
 * `@convex-dev/sandbox`'s `mkdir -p` on the staged path fails with
 * "Permission denied"). The `/tmp` tree is world-writable, so
 * `mkdir -p /tmp/aiscientist` succeeds. Defined once and reused for staging,
 * the image-capture scan, and all model-facing guidance.
 */
const WORKDIR = "/tmp/aiscientist";

/**
 * Hard cap on a single staged file's size. Files are base64-staged through a
 * shell command, so very large files are both slow and memory-heavy on the
 * sandbox side; Convex stored blobs can also be up to the storage limit. Keep
 * this conservative (10 MiB) and surface a clear error past it rather than
 * timing out mid-stage.
 */
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

/** Most figures we'll capture from a single run (keeps payloads bounded). */
const MAX_IMAGES = 6;

/**
 * Skip capturing any single image larger than this (5 MiB). A rendered chart
 * is normally well under 1 MiB; anything bigger is likely not a UI figure and
 * isn't worth the base64 round-trip and storage write.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Image extensions we look for and the MIME type we store each blob as. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  gif: "image/gif",
  webp: "image/webp",
};

/** Resolve the configured provider; default to Daytona. */
function resolveProvider(): SandboxProvider {
  const raw = (process.env.SANDBOX_PROVIDER ?? "daytona").toLowerCase();
  return raw === "sprites" ? "sprites" : "daytona";
}

/**
 * Is a sandbox credential present for the resolved provider? We check before
 * calling so we can return a friendly, actionable error instead of letting the
 * runner throw its "Set DAYTONA_API_KEY…" exception mid-turn.
 */
function hasCredential(provider: SandboxProvider): boolean {
  if (provider === "sprites") {
    return Boolean(process.env.SPRITES_TOKEN ?? process.env.SPRITE_TOKEN);
  }
  return Boolean(
    process.env.DAYTONA_API_KEY ||
      (process.env.DAYTONA_JWT_TOKEN && process.env.DAYTONA_ORGANIZATION_ID),
  );
}

/** Base64-encode an ArrayBuffer without blowing the call stack on large inputs. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // 32 KiB chunks keep String.fromCharCode happy.
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string (no whitespace) into an ArrayBuffer for blob storage.
 * Returns a plain ArrayBuffer (not a Uint8Array view) so it's an unambiguous
 * `BlobPart` regardless of the lib's SharedArrayBuffer typing.
 */
function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64.trim());
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/** Pick a stored MIME type from a file path's extension (default png). */
function contentTypeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Last path segment, used as the image's alt text. */
function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

// One runner instance for the module. The component reference is the typed
// `components.sandbox` produced once the component is registered in
// convex.config.ts.
const runner = new SandboxRunner(components.sandbox, {
  deleteSandboxAfter: true,
});

type StagedFile = { path: string; content: string; encoding: "base64" };

/**
 * Resolve + fetch the requested artifacts for this thread's task and turn
 * them into staged sandbox files. Returns the staged files plus the names that
 * resolved. Throws (with an actionable message) on a missing file or oversize
 * blob — the caller turns that into a graceful `error` result.
 */
async function stageArtifacts(
  ctx: ToolCtx,
  names: string[],
): Promise<{ files: StagedFile[]; loaded: string[] }> {
  const threadId = ctx.threadId;
  const userId = ctx.userId as Id<"users"> | undefined;
  if (!threadId || !userId) {
    throw new Error(
      "Cannot load uploaded files: missing thread/user context for this turn.",
    );
  }

  const files: StagedFile[] = [];
  const loaded: string[] = [];
  // De-duplicate names while preserving order.
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));

  for (const name of unique) {
    const artifact = await ctx.runQuery(
      internal.artifacts.getArtifactForThreadByName,
      { threadId, userId, name },
    );
    if (!artifact) {
      throw new Error(
        `No uploaded file named "${name}" is attached to this task.`,
      );
    }
    if (artifact.size > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `Uploaded file "${artifact.name}" is ${artifact.size} bytes, over the ` +
          `${MAX_ARTIFACT_BYTES}-byte limit for sandbox analysis.`,
      );
    }
    const blob = await ctx.storage.get(artifact.storageId);
    if (!blob) {
      throw new Error(
        `Uploaded file "${artifact.name}" is no longer present in storage.`,
      );
    }
    const content = toBase64(await blob.arrayBuffer());
    files.push({
      path: `${WORKDIR}/${artifact.name}`,
      content,
      encoding: "base64",
    });
    loaded.push(artifact.name);
  }
  return { files, loaded };
}

/** Read the stdout of a finished runCommand result (component nests it). */
function commandStdout(run: {
  result: { artifacts?: { stdout: string }; result: string };
}): string {
  return run.result.artifacts?.stdout ?? run.result.result ?? "";
}

/**
 * After the code has run, scan `/tmp/aiscientist` for image files the code wrote,
 * read each as base64, store it in Convex file storage, and return signed URLs.
 *
 * Best-effort: any failure (no image tooling, find/base64 missing, storage
 * hiccup) returns whatever was captured so far and never throws — image capture
 * must not fail the analysis. The sandbox is expected to already exist and is
 * NOT deleted here; the caller tears it down in its `finally`.
 *
 * The set of input files staged into `/tmp/aiscientist` (`skip`) is excluded so we
 * don't re-surface an uploaded image as if the code generated it.
 */
async function captureImages(
  ctx: ToolCtx,
  provider: SandboxProvider,
  sandboxId: string,
  skip: Set<string>,
  taskId: Id<"tasks"> | null,
): Promise<{ images: Array<{ url: string; alt?: string }>; note: string }> {
  const images: Array<{ url: string; alt?: string }> = [];
  const notes: string[] = [];

  // List candidate image files (newest first so the most relevant figures win
  // when there are more than MAX_IMAGES). NUL-separated to survive odd names.
  const exts = Object.keys(IMAGE_CONTENT_TYPES);
  const nameTests = exts.map((e) => `-iname '*.${e}'`).join(" -o ");
  const findCmd =
    `find ${WORKDIR} -maxdepth 2 -type f \\( ${nameTests} \\) ` +
    `-printf '%T@\\t%p\\0' 2>/dev/null | sort -z -rn | cut -z -f2-`;

  let listing: { result: { artifacts?: { stdout: string }; result: string } };
  try {
    listing = await runner.runCommand(ctx, {
      command: findCmd,
      sandboxId,
      timeout: CAPTURE_TIMEOUT_MS,
      deleteSandboxAfter: false,
      auth: { provider },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { images, note: `image capture skipped: ${message}` };
  }

  const raw = commandStdout(listing);
  // `find … -printf '…\0'` yields NUL-separated paths; tolerate newline output
  // too in case a provider strips NULs.
  const paths = raw
    .split(/\0|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !skip.has(p));

  for (const path of paths) {
    if (images.length >= MAX_IMAGES) {
      notes.push(`capped image capture at ${MAX_IMAGES} figures`);
      break;
    }

    // Read the raw bytes as a single base64 line so the size check is cheap.
    let read: { result: { artifacts?: { stdout: string }; result: string } };
    try {
      read = await runner.runCommand(ctx, {
        // Single-quote the path for the shell; embedded single quotes are
        // closed/reopened so the command stays well-formed.
        command: `base64 -w0 '${path.replace(/'/g, "'\\''")}'`,
        sandboxId,
        timeout: CAPTURE_TIMEOUT_MS,
        deleteSandboxAfter: false,
        auth: { provider },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`could not read ${basename(path)}: ${message}`);
      continue;
    }

    const b64 = commandStdout(read).replace(/\s+/g, "");
    if (!b64) {
      notes.push(`could not read ${basename(path)}: empty file`);
      continue;
    }
    // base64 expands bytes by ~4/3; estimate decoded size before allocating.
    const approxBytes = Math.floor((b64.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      notes.push(
        `skipped ${basename(path)}: ~${approxBytes} bytes over the ` +
          `${MAX_IMAGE_BYTES}-byte image limit`,
      );
      continue;
    }

    try {
      const buffer = fromBase64(b64);
      const type = contentTypeForPath(path);
      const blob = new Blob([buffer], { type });
      const storageId = await ctx.storage.store(blob);
      const url = await ctx.storage.getUrl(storageId);
      if (url) {
        images.push({ url, alt: basename(path) });
        // Also record the generated chart as a task artifact so it shows up in
        // the Drive (best-effort; never fail the run on a record failure). We
        // only do this when we resolved a task for this thread.
        if (taskId) {
          try {
            await ctx.runMutation(internal.artifacts.addGeneratedArtifact, {
              taskId,
              storageId,
              name: basename(path),
              contentType: type,
              size: buffer.byteLength,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            notes.push(
              `recorded ${basename(path)} inline but could not add it to the ` +
                `Drive: ${message}`,
            );
          }
        }
      } else {
        notes.push(`stored ${basename(path)} but could not resolve its URL`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`could not store ${basename(path)}: ${message}`);
    }
  }

  return { images, note: notes.join("; ") };
}

export const code = createTool({
  description:
    "Run code in a secure, isolated sandbox (Python) and return its stdout, " +
    "stderr, and result — your general-purpose execution tool. Use it for any " +
    "real computation, simulation, statistics, parsing, data transformation, or " +
    "plotting rather than reasoning alone, AND as an ESCAPE HATCH to reach a web " +
    "API or data source that has no dedicated tool: the sandbox has outbound " +
    "network access, so you can fetch from it in code (e.g. Python " +
    "`urllib`/`requests`) and install packages as needed. Prefer a dedicated " +
    "tool when one fits — e.g. `literature_search` for papers, `uniprot_lookup` " +
    "for proteins — since those are faster, keyless, and return structured, " +
    "cited results; fall back to this tool for everything else. Always write the " +
    "code, run it here, and report what it ACTUALLY printed. " +
    "UPLOADED FILES: the user can attach data files to the project. To analyze " +
    "one, pass its exact name in `artifactName` (or several in `artifactNames`); " +
    "it will be placed in the sandbox at `/tmp/aiscientist/<name>` BEFORE your " +
    "code runs, so read it from that absolute path (e.g. " +
    "`open('/tmp/aiscientist/data.csv')` or " +
    "`pandas.read_csv('/tmp/aiscientist/data.csv')`). " +
    "If you do NOT load a file, the sandbox is empty and your code must be " +
    "fully self-contained (embed any data inline). Always PRINT every result " +
    "you need to stdout — only stdout/stderr are returned. " +
    "CHARTS/FIGURES: to show the user a plot, SAVE it as an image file under " +
    "`/tmp/aiscientist/` (e.g. matplotlib " +
    "`plt.savefig('/tmp/aiscientist/plot.png')`; do NOT call `plt.show()` — " +
    "there is no display). Saved .png/.jpg/.jpeg/.svg images in " +
    "`/tmp/aiscientist/` are captured automatically and shown to the user " +
    "inline, so prefer saving a figure over describing one. Default language " +
    "is Python.",
  inputSchema: z.object({
    code: z
      .string()
      .describe(
        "Self-contained code to run for the analysis. Read any loaded " +
          "uploaded files from `/tmp/aiscientist/<name>`. If you load nothing, " +
          "embed all data inline. PRINT every result you need to stdout (e.g. " +
          "Python `print(...)`); only stdout/stderr are returned, so a value " +
          "left unprinted is lost. To show a chart, SAVE it to " +
          "`/tmp/aiscientist/` (e.g. " +
          "`plt.savefig('/tmp/aiscientist/plot.png')`) instead of calling " +
          "`plt.show()`; saved images are captured and displayed to the user.",
      ),
    language: z
      .enum(["python"])
      .optional()
      .describe(
        "Language of the code. Currently only 'python' is supported (default).",
      ),
    artifactName: z
      .string()
      .optional()
      .describe(
        "Name of ONE uploaded data file to load into the sandbox before the " +
          "run. Must exactly match a file attached to this project (see the " +
          "uploaded-files note in context). The file is placed at " +
          "`/tmp/aiscientist/<name>`.",
      ),
    artifactNames: z
      .array(z.string())
      .optional()
      .describe(
        "Names of MULTIPLE uploaded data files to load before the run (use " +
          "instead of `artifactName` when you need several). Each is placed at " +
          "`/tmp/aiscientist/<name>`.",
      ),
  }),
  execute: async (
    ctx,
    { code, language, artifactName, artifactNames },
  ): Promise<CodeExecResult> => {
    const lang = language ?? "python";
    const provider = resolveProvider();

    // Graceful no-key path: surface a clear, actionable error and echo the
    // code back so the UI can still show what the agent intended to run.
    if (!hasCredential(provider)) {
      const keyHint =
        provider === "sprites"
          ? "SPRITES_TOKEN"
          : "DAYTONA_API_KEY (or DAYTONA_JWT_TOKEN + DAYTONA_ORGANIZATION_ID)";
      return {
        kind: "code-exec",
        language: lang,
        code,
        stdout: "",
        stderr: "",
        error:
          `Sandbox code execution is not configured: ${keyHint} is not set ` +
          `on the Convex deployment (provider "${provider}"). The code was ` +
          `not run.`,
      };
    }

    // Collect the requested file names (single + array, both optional).
    const requested = [
      ...(artifactName ? [artifactName] : []),
      ...(artifactNames ?? []),
    ];

    // Resolve + fetch the requested artifacts BEFORE provisioning the sandbox,
    // so a bad file name fails fast without spending a sandbox.
    let staged: { files: StagedFile[]; loaded: string[] } = {
      files: [],
      loaded: [],
    };
    if (requested.length > 0) {
      try {
        staged = await stageArtifacts(ctx, requested);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          kind: "code-exec",
          language: lang,
          code,
          stdout: "",
          stderr: "",
          error: `Could not load uploaded file(s): ${message}`,
        };
      }
    }

    // Both paths (with or without staged files) now create an explicit
    // sandbox, run the code WITHOUT auto-deleting, then scan `/tmp/aiscientist` for
    // generated figures, and finally tear the sandbox down. Keeping the sandbox
    // alive across runCode→capture is what makes the filesystem scan possible;
    // the previous "fast path" used runCode's auto-delete, which would have
    // dropped the figures before we could read them.
    let sandboxId: string | undefined;
    try {
      const sandbox = await runner.createSandbox(ctx, {
        auth: { provider },
        create: { language: lang },
        // Empty `files` is fine; the no-upload case just stages nothing.
        files: staged.files,
      });
      sandboxId = sandbox.id;

      const run = await runner.runCode(ctx, {
        code,
        language: lang,
        timeout: RUN_TIMEOUT_MS,
        sandboxId,
        // Don't auto-delete inside runCode; we capture images and delete
        // explicitly below so teardown happens even if something throws.
        deleteSandboxAfter: false,
        auth: { provider },
      });

      const out = shapeRun(run, lang, code, staged.loaded);

      // Resolve the task backing this thread so captured charts can be recorded
      // as generated artifacts (shows them in the Drive). Best-effort: if we
      // can't resolve it (no thread/user context, or no matching task), we still
      // return the images inline — we just skip the Drive record.
      let taskId: Id<"tasks"> | null = null;
      const threadId = ctx.threadId;
      const toolUserId = ctx.userId as Id<"users"> | undefined;
      if (threadId && toolUserId) {
        try {
          taskId = await ctx.runQuery(internal.artifacts.getTaskIdForThread, {
            threadId,
            userId: toolUserId,
          });
        } catch {
          taskId = null;
        }
      }

      // Capture any figures the code wrote. Exclude staged input files so an
      // uploaded image isn't echoed back as a generated one. Best-effort: on
      // failure we keep the run result and just skip images.
      const skip = new Set(staged.files.map((f) => f.path));
      const { images, note } = await captureImages(
        ctx,
        provider,
        sandboxId,
        skip,
        taskId,
      );
      if (images.length > 0) {
        out.images = images;
      }
      if (note) {
        // Surface capture notes (skipped/oversize/cap) in stderr without
        // clobbering a real traceback.
        out.stderr = out.stderr
          ? `${out.stderr}\n[image capture] ${note}`
          : `[image capture] ${note}`;
      }
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        kind: "code-exec",
        language: lang,
        code,
        stdout: "",
        stderr: "",
        loaded: staged.loaded.length > 0 ? staged.loaded : undefined,
        error: `Sandbox execution failed: ${message}`,
      };
    } finally {
      if (sandboxId) {
        try {
          await runner.deleteSandbox(ctx, { auth: { provider }, sandboxId });
        } catch {
          // Best-effort teardown; the component also auto-deletes ephemerals.
        }
      }
    }
  },
});

/** Map a sandbox run result into our stable CodeExecResult shape. */
function shapeRun(
  run: {
    result: {
      exitCode: number;
      stderr?: string;
      result: string;
      artifacts?: { stdout: string };
    };
  },
  lang: string,
  code: string,
  loaded: string[],
): CodeExecResult {
  const { exitCode, stderr, result } = run.result;
  const stdout = run.result.artifacts?.stdout ?? "";
  const out: CodeExecResult = {
    kind: "code-exec",
    language: lang,
    code,
    stdout,
    stderr: stderr ?? "",
  };
  if (result) out.result = result;
  if (loaded.length > 0) out.loaded = loaded;
  // A nonzero exit isn't a harness failure, but flag it so the model knows the
  // script errored (the traceback is in stderr).
  if (exitCode !== 0) {
    out.error = `Code exited with status ${exitCode}; see stderr.`;
  }
  return out;
}
