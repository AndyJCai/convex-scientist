# Contributing a tool

The research agent's capabilities are just files in this folder (`convex/tools/`).
Adding a tool is the easiest way to contribute — the agent's prompt is generated
from the live registry, so a new tool wires itself into the model with no prompt
edits.

**Conventions** (`one file = one tool`, all `snake_case`):

- File name = export name = registry key. Keep all three identical so they never drift.
- Define the tool with `createTool` from `@convex-dev/agent`: a `description`
  (the model reads this to decide when to call it), a zod `inputSchema` with a
  `.describe()` on every field, and an `execute` function.
- **Never throw.** On any failure return a normal result with an `error` field so
  the agent's turn survives and it can adapt. Cap large payloads to keep context small.
- Keep a stable output shape — the frontend `ToolCallCard` renders results
  generically (it reads a `query` for the arg summary and an array of records).
- Keyless HTTP APIs work in Convex's default runtime via `fetch`. For a tool that
  needs a secret, read it from `process.env.YOUR_KEY` and document it in
  [docs/SETUP.md](../../docs/SETUP.md); set it with `npx convex env set`.

**1. Create `convex/tools/my_tool.ts`:**

```ts
import { z } from "zod";
import { createTool } from "@convex-dev/agent";

export const my_tool = createTool({
  description: "What this does and when the agent should call it.",
  inputSchema: z.object({
    query: z.string().describe("What to look up."),
  }),
  execute: async (_ctx, { query }) => {
    try {
      const res = await fetch(`https://api.example.com/?q=${encodeURIComponent(query)}`);
      if (!res.ok) return { query, results: [], error: `HTTP ${res.status}` };
      const data = await res.json();
      return { query, results: data.items ?? [] };
    } catch (err) {
      return { query, results: [], error: err instanceof Error ? err.message : String(err) };
    }
  },
});
```

**2. Register it** in [`index.ts`](index.ts) — add one line to the `tools` object
(keep `code` last; it carries the prompt-cache breakpoint):

```ts
import { my_tool } from "./my_tool";
// ...
export const tools = { literature_search, ask_user, uniprot_lookup, my_tool, code: code_cached };
```

With `npx convex dev` running, the new tool is live immediately — start a chat
and ask something that should trigger it.

Open a PR against [AndyJCai/convex-scientist](https://github.com/AndyJCai/convex-scientist).
[`uniprot_lookup.ts`](uniprot_lookup.ts) is a good reference for a real, keyless
tool; [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) covers the broader design.
