# Convex Scientist

An open-source AI research companion built on [Convex](https://convex.dev/) + Next.js — upload datasets, chat with a research agent, and organize generated outputs per task and project.

## Stack

- [Convex](https://convex.dev/) for the backend (database, server logic, the agent runtime)
- [Next.js](https://nextjs.org/) + [React](https://react.dev/) for the frontend
- [`@convex-dev/auth`](https://labs.convex.dev/auth) with passkey (WebAuthn) sign-in
- [Claude](https://www.anthropic.com/) (via the AI SDK) as the research agent
- [Tailwind](https://tailwindcss.com/) and [shadcn/ui](https://ui.shadcn.com/) for the UI

## Setup

```bash
npm install
npx convex dev      # links a deployment, writes .env.local
```

Then generate auth keys and set your Anthropic key:

```bash
npx @convex-dev/auth                         # passkey signing keys
npx convex env set ANTHROPIC_API_KEY sk-ant-...
npm run dev                                  # in a second terminal
```

Full instructions, optional config, and deployment notes are in
**[docs/SETUP.md](docs/SETUP.md)**.

## Contributing a tool

The research agent's capabilities are just files in
[`convex/tools/`](convex/tools/). Adding a tool is the easiest way to contribute
— the agent's prompt is generated from the live registry, so a new tool wires
itself into the model with no prompt edits.

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
  [docs/SETUP.md](docs/SETUP.md); set it with `npx convex env set`.

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

**2. Register it** in [`convex/tools/index.ts`](convex/tools/index.ts) — add one
line to the `tools` object (keep `code` last; it carries the prompt-cache
breakpoint):

```ts
import { my_tool } from "./my_tool";
// ...
export const tools = { literature_search, ask_user, uniprot_lookup, my_tool, code: code_cached };
```

With `npx convex dev` running, the new tool is live immediately — start a chat
and ask something that should trigger it.

Open a PR against [AndyJCai/convex-scientist](https://github.com/AndyJCai/convex-scientist).
[uniprot_lookup.ts](convex/tools/uniprot_lookup.ts) is a good reference for a
real, keyless tool; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the
broader design.

## Learn more

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how this app is designed
- [Convex docs](https://docs.convex.dev/) and the [Tour of Convex](https://docs.convex.dev/get-started)
- Join the [Convex Discord community](https://convex.dev/community)
