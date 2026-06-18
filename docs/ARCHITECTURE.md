# Convex Scientist — Architecture

> Living design doc. Edit as the design evolves.

## What this is

An open-source, extensible **AI research harness on Convex**, presented as a
Claude-style chat interface. The value isn't any single tool — it's the
**durable, resumable, human-in-the-loop orchestration** around a registry of
pluggable scientific tools. The agent (Claude, BYO key) drives the tools; the
harness keeps the research lifecycle coherent and restartable; the user
experiences it as a conversation.

## Principles

1. **Harness, not monolith.** Durability, resumability, and live observability
   are first-class.
2. **Wrap, don't rebuild.** Every tool fronts an existing API or service. If
   there's an API, use it.
3. **One file = one tool.** A new integration is a single self-describing
   `createTool` file plus one line in the registry — the only integration point.
   Schema comes from the zod `inputSchema` + descriptions; no hand-written JSON.
4. **BYO key & model.** Defaults to Claude (`ANTHROPIC_API_KEY`); model and
   provider are swappable. Keys never reach the client.
5. **Chat-first.** Thread sidebar, streaming messages, inline tool-call cards.
   Lifecycle gates render as inline chat affordances, not separate screens.
6. **Human-in-the-loop.** Hypothesis approval and real-world experiments are
   explicit gates the harness parks on — indefinitely if needed.
7. **The agent drives tool use.** The model chooses which tools to call and when
   (standard tool-use / ReAct); the harness never scripts a fixed tool sequence.
   The step cap is only a runaway bound. The harness sequences only the
   human-gated lifecycle.
8. **Prefer Convex components.** Use a solid existing component when one fits
   (`@convex-dev/agent` for the agent loop, `@convex-dev/sandbox` for code). If
   none exists for a need, build a reusable one rather than a bespoke one-off.

## System layers

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER — Next.js + shadcn                                    │
│  • passkey auth (Convex Auth)   • thread sidebar               │
│  • streaming messages (useQuery)• inline tool-call cards       │
│  • inline human-gate affordances (approve ideas / submit data) │
└───────────▲──────────────────────────────────┬────────────────┘
  reactive  │ WebSocket subscriptions           │ mutations / actions
  reads     │                                   ▼
┌───────────┴────────────────────────────────────────────────────┐
│  CONVEX BACKEND                                                  │
│   HARNESS — research state machine (one per thread)             │
│     pick next step → run durably → judge → transition / park    │
│                                                                 │
│   AGENT LOOP            DATA                  DURABILITY         │
│   @convex-dev/agent     threads/messages      scheduler +        │
│   + Claude (tool-use)   (agent component)     @convex-dev/        │
│        │                projects/artifacts    workflow (waits,   │
│        ▼                hypotheses/experiments retries)          │
│   TOOL REGISTRY (convex/tools/ — 1 file = 1 tool)               │
│     literature_search → OpenAlex / arXiv                        │
│     uniprot_lookup    → UniProt REST                            │
│     ask_user          → human gate                              │
│     code              → @convex-dev/sandbox (Daytona / Fly)     │
└──────────────────────────────┬──────────────────────────────────┘
                               ▼  BYO-key external calls
                    Anthropic API (Claude) · scientific REST APIs
```

## Research lifecycle

The whole flow happens inside one chat thread. States describe what the agent
is doing or waiting for; human gates (║ boxes) appear as inline affordances.

```
  INTAKE          user describes a research area (first message)
    ▼
  TRIAGE          literature_search + novelty check ──already solved──▶ REPORTED
    ▼ novel
  HYPOTHESIS      generate hypotheses grounded in literature
    ▼
 ║ AWAITING_APPROVAL ║  ◀── human gate: approve / edit / reject
    ▼ approved
  EXPERIMENT_DESIGN  protocol for a human to run
    ▼
 ║ AWAITING_EXPERIMENT ║ ◀── human gate: run experiment, submit results
    ▼ data submitted
  ANALYSIS        run analysis in the sandbox (if data needs it)
    ▼
  CONCLUDED       cited conclusion; may spawn a follow-up thread
```

Every agent-driven transition: run step → judge → advance / revise, with the
human able to override.

> **Shipped today:** chat spine, the agent loop, and the four tools below.
> The lifecycle gates and judge are designed but not yet fully built — the rails
> (durable state, scheduler-driven resume) are in place to layer them on.

## Tools

Each tool is one self-describing `createTool` file in `convex/tools/`, registered
with one line in `convex/tools/index.ts`. The agent's system prompt lists tools
from the live registry, so adding a file auto-updates the prompt. The pattern:
`execute` calls a REST/GraphQL endpoint with `fetch()` (no `"use node"` in the
V8 runtime), normalizes to a stable output shape for the tool-call card, and
never throws — on failure it returns a graceful `{ …, error }` so the agent's
turn survives. See the [contributing guide](../README.md#contributing-a-tool).

**Shipped**

- `literature_search` — one tool fronting multiple scholarly sources (OpenAlex
  now; arXiv / Semantic Scholar / PubMed as added backends). Keyless.
- `uniprot_lookup` — protein function / sequence / annotations by name, gene,
  keyword, or accession (UniProt REST, keyless). The structural-biology hub: it
  yields the accessions downstream structure tools consume.
- `code` — the general-purpose executor (computation, stats, plotting) and the
  escape hatch for long-tail APIs with no dedicated wrapper, run in an isolated
  `@convex-dev/sandbox` (Daytona, or Fly via `SANDBOX_PROVIDER=sprites`). Without
  a provider key it returns a graceful "not configured" error.
- `ask_user` — surfaces a question as an inline human gate.

**Proposed** (mostly keyless, one `createTool` file each)

- *Structural biology:* `alphafold_lookup`, `pdb_search`, later `esmfold_predict`.
- *Chemistry:* `pubchem_lookup`, `chembl_lookup`.
- *Genomics:* `ensembl_lookup`, `gnomad_variant`, `clinvar_lookup`.

Keyless tools ship with no new env config — they degrade gracefully, like the
sandbox without a provider key.

## Components

- **Chat UI** — thread sidebar (each thread = one research project), streaming
  message view, composer. Tool calls render inline as expandable cards; human
  gates render as inline interactive messages. All reactive via `useQuery` over
  the agent component's threads/messages.
- **Harness** — durable state machine, one row per thread. Picks the next step,
  runs it, judges, transitions or parks on a gate. Progression (including
  indefinite waits) is data-driven: a user mutation flips state and schedules the
  next step (`scheduler.runAfter`) — no long-blocking processes.
- **Agent loop** — `@convex-dev/agent` (AI SDK + `@ai-sdk/anthropic`). Runs the
  Claude tool-use loop, streams steps over WebSocket, persists thread state. The
  model chooses tools each turn; the step cap (`stopWhen: stepCountIs(N)`) is only
  a safety bound. Default model `claude-sonnet-4-6` (swappable, BYO).
- **Tool registry** — `convex/tools/`, the only integration point for
  contributors. Each tool delegates side-effecting/Node work to a separate action.
- **Judge** — *designed, not yet built.* Will score each step's artifact; advise
  and human-overridable by default, never the sole ground truth.
- **Sandbox** — `@convex-dev/sandbox` (Daytona / Fly), used by `code` to run
  agent-emitted code with outbound network egress. Isolated remote execution —
  agent code never runs in the backend trust boundary.
- **Data model** — threads/messages/tool steps come from `@convex-dev/agent`. App
  tables add research structure: `projects`, `artifacts` (uploaded files in Convex
  storage), `hypotheses`, `experiments`, `findings`, plus auth tables. Everything
  scoped to `getAuthUserId(ctx)`.
- **Auth** — Convex Auth passkeys. Identity = Convex user `_id`.

## Agent system prompt

Composed from two parts so it always reflects the live registry:

1. A static role/strategy preamble (rigor, grounding claims in tool results,
   never fabricating citations, model-driven tool choice).
2. A "Tools available" section generated from the registry — each tool's name +
   description — so adding a tool file auto-updates the prompt.

## Open questions

- **Judge mode** — gate (block until pass) vs advise (annotate, never block).
  Leaning advise + human-overridable; gate only on cheap objective checks.
- **Triage exit** — does "already solved" end the project, or downgrade to
  "refine the question"?

## Prior art (reference, do not copy)

- **Sakana "AI Scientist"** — idea→experiment→write-up→review pipeline. Lesson:
  enforce sandboxing and bound loops with explicit stop criteria.
- **Google "AI co-scientist"** — multi-agent generate→debate→evolve with an Elo
  tournament; source of the optional hypothesis-tournament idea.
- **ChemCrow / Coscientist** — ReAct over a curated tool belt plus an isolated
  REPL. Lesson: an LLM judge can't reliably tell wrong-but-fluent from correct —
  keep humans in the loop. This is the model we follow: curated tools *plus* a
  general code tool.
- **PaperQA / PaperQA2** — agentic RAG with function-signature schema generation
  and no heavy framework coupling — the tool ergonomics we borrow.
