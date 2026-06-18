import { literature_search } from "./literature_search";
import { ask_user } from "./ask_user";
import { uniprot_lookup } from "./uniprot_lookup";
import { code } from "./code";

// The tool registry. Add new tools here as a single line.
// Each entry's KEY is the tool name the model sees (e.g. "literature_search").
// File name = export name = registry key (all snake_case) so the three never drift.
// Note: literature_search is ONE tool fronting MANY scholarly sources (OpenAlex,
// arXiv, …) — see convex/tools/literature_search.ts for the source registry.
//
// PROMPT CACHING: Anthropic caches the request prefix in order
// `tools → system → messages` up to each `cache_control` breakpoint. We mark the
// LAST tool definition with an ephemeral breakpoint so the ENTIRE tools block is
// a cacheable prefix (a breakpoint caches everything up to and including it, so
// it must sit on the last tool — keep it on whatever entry is last here).
//
// The primary breakpoint lives on the system message (see convex/scientist.ts
// CACHED_SYSTEM), which — being after `tools` in request order — already caches
// `tools + system` together. This tool-level breakpoint is belt-and-suspenders
// so the tools block stays cacheable even if the system prompt is overridden.
// `@convex-dev/agent`'s createTool/wrapTools preserve `providerOptions`, and
// `@ai-sdk/anthropic` (prepareTools) reads `providerOptions.anthropic.cacheControl`
// off the tool to emit `cache_control` on that tool definition.
const code_cached = {
  ...code,
  providerOptions: {
    ...code.providerOptions,
    anthropic: {
      ...(code.providerOptions?.anthropic as
        | Record<string, unknown>
        | undefined),
      cacheControl: { type: "ephemeral" as const },
    },
  },
};

export const tools = {
  literature_search,
  ask_user,
  uniprot_lookup,
  code: code_cached, // stays LAST — keeps the cache breakpoint
};
