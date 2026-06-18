"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Shows a "new version available" banner when the published static-site version
// increments past the one this tab loaded with. Reactive: appVersion.getCurrent
// updates the instant `node publish-convex-app.mjs` records a new deploy.
export function NewVersionBanner() {
  const current = useQuery(api.appVersion.getCurrent);
  const baseline = useRef<number | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (current == null) return;
    if (baseline.current === null) baseline.current = current.version;
    else if (current.version > baseline.current) setStale(true);
  }, [current]);

  if (!stale) return null;

  return (
    <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", gap: 12, alignItems: "center", padding: "10px 16px", borderRadius: 9999, background: "#111", color: "#fff", boxShadow: "0 8px 30px rgba(0,0,0,.35)", fontSize: 14 }}>
      <span>A new version is available</span>
      <button onClick={() => location.reload()} style={{ padding: "4px 12px", borderRadius: 9999, background: "#fff", color: "#111", border: 0, cursor: "pointer", fontWeight: 600 }}>Reload</button>
    </div>
  );
}
