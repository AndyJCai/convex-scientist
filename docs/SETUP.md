# Setup

How to get Convex Scientist running locally from a fresh clone. For what the
app *is* and how it's built, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- **Node.js 18+** (developed on 22) and npm.
- A **[Convex](https://convex.dev)** account — free; created during step 2.
- An **[Anthropic API key](https://console.anthropic.com/)** — the research
  agent runs on Claude by default. Required.
- *(Optional)* A code-sandbox provider for the agent's code-execution tool —
  [Daytona](https://www.daytona.io/) or Fly Sprites. The app runs fine without
  one; the code tool just reports as unavailable.

## 1. Install dependencies

```bash
npm install
```

## 2. Link a Convex deployment

```bash
npx convex dev
```

The first run logs you into Convex, creates a dev deployment, and writes
`CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and `NEXT_PUBLIC_CONVEX_SITE_URL`
into `.env.local` for you. Leave this process running — it watches and pushes
the `convex/` backend.

## 3. Generate passkey auth keys

Auth uses [`@convex-dev/auth`](https://labs.convex.dev/auth) with the **Passkey**
(WebAuthn) provider. Generate the signing keys and set them on the deployment:

```bash
npx @convex-dev/auth
```

This provisions `JWT_PRIVATE_KEY` and `JWKS` as Convex deployment env vars (and
writes a local `.auth-keys.json`, which is gitignored). `CONVEX_SITE_URL` —
which `convex/auth.config.ts` reads — is provided automatically by Convex.

## 4. Set the Anthropic API key

The agent reads `ANTHROPIC_API_KEY` from the **Convex deployment** environment
(not `.env.local`), since the agent runs server-side in Convex actions:

```bash
npx convex env set ANTHROPIC_API_KEY sk-ant-...
```

To use a different model or provider, change `SCIENTIST_MODEL` (and the
provider factory) in [`convex/scientist.ts`](../convex/scientist.ts).

## 5. Run the app

With `npx convex dev` still running in one terminal, start Next.js in another:

```bash
npm run dev
```

Open the printed URL (typically http://localhost:3000), create a passkey to
sign in, and start a research conversation.

## Optional configuration

All optional vars are set on the **Convex deployment** with
`npx convex env set <NAME> <value>`:

| Variable | Purpose |
| --- | --- |
| `SANDBOX_PROVIDER` | `daytona` (default) or `sprites` — selects the code-execution backend. |
| `DAYTONA_API_KEY` | Daytona auth (or use `DAYTONA_JWT_TOKEN` + `DAYTONA_ORGANIZATION_ID`). |
| `SPRITES_TOKEN` | Fly Sprites auth, when `SANDBOX_PROVIDER=sprites`. |
| `OPENALEX_MAILTO` | Contact email sent to the OpenAlex literature API (politeness pool). |
| `FEEDBACK_AGENT_KEY` | Auth for the in-app Chef feedback panel; optional. |

Without a sandbox provider configured, the agent's code tool is simply reported
as unavailable — the rest of the app (chat, literature search, file drive)
works normally.

## Environment summary

- **`.env.local`** (frontend, git-ignored; see [`.env.example`](../.env.example)):
  `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` —
  all written by `npx convex dev`.
- **Convex deployment env** (server secrets, set via `npx convex env set` or the
  Convex dashboard): `ANTHROPIC_API_KEY` (required), `JWT_PRIVATE_KEY` + `JWKS`
  (from step 3), and any optional vars above. `CONVEX_SITE_URL` is built in.

## Deploying

Run `npx convex deploy` for a production Convex deployment, then host the
Next.js frontend (e.g. Vercel) with `NEXT_PUBLIC_CONVEX_URL` /
`NEXT_PUBLIC_CONVEX_SITE_URL` pointing at it. Re-run steps 3–4 against the
production deployment so its auth keys and `ANTHROPIC_API_KEY` are set.
