"use client";
import { useEffect } from "react";

// The panel's UI lives in chef-panel.js, served from anteater so display/CSS
// fixes ship instantly. It talks to the host's wow:* wrapper functions.
const PANEL_JS = "https://graceful-tiger-715.convex.site/chef-panel";

// NAMED export — layout.tsx does `import { ChefPanel } from "./_chef-panel"`.
// A default export makes ChefPanel undefined → "Element type is invalid" → 500.
export function ChefPanel() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return;
    if (!document.querySelector(`script[data-chef-panel]`)) {
      const s = document.createElement("script");
      s.type = "module";
      s.src = PANEL_JS;
      s.setAttribute("data-chef-panel", "1");
      document.head.appendChild(s);
    }
    const el = document.createElement("chef-panel");
    el.setAttribute("convex-url", url);
    el.setAttribute("prefix", "wow");
    document.body.appendChild(el);
    return () => { el.remove(); };
  }, []);
  return null;
}
