import { z } from "zod";
import { createTool } from "@convex-dev/agent";

/**
 * literature_search — grounds the agent's claims in real papers, across MANY
 * scholarly sources, behind ONE tool.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE TOOL = ALL SOURCES (provider abstraction)
 * ──────────────────────────────────────────────────────────────────────────
 * The model sees a single `literature_search` tool. Internally we keep a
 * registry of "source functions", each `(query, limit) => Promise<Paper[]>`.
 * `execute` fans out to the selected sources CONCURRENTLY (Promise.allSettled),
 * merges + dedupes the results, and tags each paper with its `source`. A single
 * source failing or rate-limiting (429) must NOT fail the tool — we return
 * whatever succeeded.
 *
 * Today we wire two KEYLESS sources to prove the multi-source design:
 *   • OpenAlex — Works API; abstracts reconstructed from `abstract_inverted_index`;
 *     `mailto` polite pool. (~250M works.)
 *   • arXiv    — Atom feed query API; title/authors/year/summary/abs link.
 * To add Semantic Scholar / PubMed later, append one entry to SOURCES below.
 *
 * `fetch()` is available in the default Convex (V8) runtime, so this file needs
 * no `"use node"` and the tool can call out directly from its `execute`.
 *
 * CRITICAL — keep this output shape stable; the frontend ToolCallCard renders it:
 *   { provider: string, query: string, papers: Paper[] }
 * `provider` is a summary of the sources queried (e.g. "openalex+arxiv").
 */

export type Paper = {
  title: string;
  authors: string[];
  year?: number;
  /** Reconstructed/extracted abstract; omitted when the source has none. */
  abstract?: string;
  url?: string;
  citationCount?: number;
  /** Which source this paper came from (e.g. "openalex", "arxiv"). */
  source?: string;
};

export type LiteratureSearchResult = {
  /** Summary of the sources actually queried, e.g. "openalex+arxiv". */
  provider: string;
  query: string;
  papers: Paper[];
  /** Present only when EVERY selected source failed; the tool never throws. */
  error?: string;
};

/** The keyless sources we can search today. Extend the enum + SOURCES together. */
const SOURCE_IDS = ["openalex", "arxiv"] as const;
type SourceId = (typeof SOURCE_IDS)[number];

/** Default contact for OpenAlex's "polite pool"; overridable via env. */
const DEFAULT_MAILTO = "ai-scientist@convex.dev";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_ABSTRACT_CHARS = 600;

function truncate(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_ABSTRACT_CHARS
    ? trimmed.slice(0, MAX_ABSTRACT_CHARS).trimEnd() + "…"
    : trimmed;
}

// ──────────────────────────────────────────────────────────────────────────
// OpenAlex source
// ──────────────────────────────────────────────────────────────────────────

/**
 * OpenAlex stores abstracts as an inverted index: `{ word: number[] positions }`.
 * Rebuild the prose by placing each word at each of its positions, then joining
 * with spaces. Returns undefined when the index is missing or empty.
 */
function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null | undefined,
): string | undefined {
  if (!invertedIndex) return undefined;
  const entries = Object.entries(invertedIndex);
  if (entries.length === 0) return undefined;

  let maxPos = -1;
  for (const [, positions] of entries) {
    for (const pos of positions) {
      if (pos > maxPos) maxPos = pos;
    }
  }
  if (maxPos < 0) return undefined;

  const words: string[] = new Array(maxPos + 1).fill("");
  for (const [word, positions] of entries) {
    for (const pos of positions) {
      if (pos >= 0 && pos <= maxPos) words[pos] = word;
    }
  }
  return truncate(words.join(" ").replace(/\s+/g, " "));
}

type OpenAlexWork = {
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  doi?: string | null;
  id?: string | null;
  primary_location?: { landing_page_url?: string | null } | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }> | null;
};

function mapOpenAlexWork(work: OpenAlexWork): Paper {
  const authors = (work.authorships ?? [])
    .map((a) => a.author?.display_name ?? "")
    .filter((name): name is string => name.length > 0);

  const url =
    work.primary_location?.landing_page_url ??
    work.doi ??
    work.id ??
    undefined;

  const paper: Paper = {
    title: work.display_name?.trim() || "(untitled)",
    authors,
    source: "openalex",
  };
  if (typeof work.publication_year === "number") {
    paper.year = work.publication_year;
  }
  const abstract = reconstructAbstract(work.abstract_inverted_index);
  if (abstract) paper.abstract = abstract;
  if (url) paper.url = url;
  if (typeof work.cited_by_count === "number") {
    paper.citationCount = work.cited_by_count;
  }
  return paper;
}

async function searchOpenAlex(query: string, limit: number): Promise<Paper[]> {
  const mailto = process.env.OPENALEX_MAILTO || DEFAULT_MAILTO;
  const url =
    "https://api.openalex.org/works" +
    `?search=${encodeURIComponent(query)}` +
    `&per_page=${limit}` +
    `&mailto=${encodeURIComponent(mailto)}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenAlex request failed (${res.status} ${res.statusText}): ${body.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { results?: OpenAlexWork[] };
  return (json.results ?? []).slice(0, limit).map(mapOpenAlexWork);
}

// ──────────────────────────────────────────────────────────────────────────
// arXiv source
// ──────────────────────────────────────────────────────────────────────────

/** Decode the handful of XML entities the arXiv Atom feed emits. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Collapse whitespace and decode entities for a text node's contents. */
function cleanText(text: string): string {
  return decodeXmlEntities(text).replace(/\s+/g, " ").trim();
}

/**
 * Extract the inner text of the FIRST `<tag>…</tag>` in `xml`. Returns "" when
 * the tag is absent. Used for single-valued Atom fields (title, summary, …).
 */
function firstTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? cleanText(m[1]) : "";
}

/** Extract the inner text of EVERY `<tag>…</tag>` in `xml`. */
function allTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = cleanText(m[1]);
    if (text) out.push(text);
  }
  return out;
}

/** Pull the `href` of the canonical abs/landing link from an Atom entry. */
function arxivEntryUrl(entry: string): string | undefined {
  // Prefer the alternate (HTML abs page) link; fall back to <id> (also the abs URL).
  const altMatch = entry.match(
    /<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*>/i,
  );
  if (altMatch) return decodeXmlEntities(altMatch[1]);
  const id = firstTag(entry, "id");
  return id || undefined;
}

function mapArxivEntry(entry: string): Paper {
  const title = firstTag(entry, "title") || "(untitled)";
  // arXiv wraps each author name in <author><name>…</name></author>.
  const authors = allTags(entry, "name");
  const paper: Paper = { title, authors, source: "arxiv" };

  const published = firstTag(entry, "published"); // e.g. 2023-05-01T...
  const yearMatch = published.match(/^(\d{4})/);
  if (yearMatch) paper.year = Number(yearMatch[1]);

  const abstract = truncate(firstTag(entry, "summary"));
  if (abstract) paper.abstract = abstract;

  const url = arxivEntryUrl(entry);
  if (url) paper.url = url;

  return paper;
}

async function searchArxiv(query: string, limit: number): Promise<Paper[]> {
  const url =
    "http://export.arxiv.org/api/query" +
    `?search_query=${encodeURIComponent(`all:${query}`)}` +
    `&start=0&max_results=${limit}`;

  const res = await fetch(url, { headers: { Accept: "application/atom+xml" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `arXiv request failed (${res.status} ${res.statusText}): ${body.slice(0, 200)}`,
    );
  }
  const xml = await res.text();
  // Split the feed into <entry>…</entry> blocks (the feed-level <title> etc. are
  // outside any <entry>, so this cleanly isolates the result rows).
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return entries.slice(0, limit).map(mapArxivEntry);
}

// ──────────────────────────────────────────────────────────────────────────
// Source registry — add a source by appending one entry here (and to the enum).
// ──────────────────────────────────────────────────────────────────────────

type SourceFn = (query: string, limit: number) => Promise<Paper[]>;

const SOURCES: Record<SourceId, SourceFn> = {
  openalex: searchOpenAlex,
  arxiv: searchArxiv,
};

// ──────────────────────────────────────────────────────────────────────────
// Merge + dedupe
// ──────────────────────────────────────────────────────────────────────────

/** Normalize a title for dedupe: lowercase, strip punctuation, collapse spaces. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normalize a DOI (when the URL is a doi.org link) for cross-source dedupe. */
function doiKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/10\.\d{4,9}\/[^\s"<>]+/i);
  return m ? m[0].toLowerCase() : undefined;
}

/**
 * Merge papers from several sources, dropping duplicates. Two papers are the
 * same if they share a normalized title OR a DOI. When a duplicate is found we
 * keep the first-seen paper but fill in any missing fields from the later one
 * (so e.g. an arXiv abstract can backfill an OpenAlex hit that lacked one).
 */
function mergeAndDedupe(groups: Paper[][]): Paper[] {
  const byKey = new Map<string, Paper>();
  const order: string[] = [];

  for (const group of groups) {
    for (const paper of group) {
      const titleKey = `t:${normalizeTitle(paper.title)}`;
      const doi = doiKey(paper.url);
      const dKey = doi ? `d:${doi}` : undefined;

      // Find an existing entry under either key.
      const existingKey =
        (dKey && byKey.has(dKey) && dKey) ||
        (byKey.has(titleKey) && titleKey) ||
        undefined;

      if (existingKey) {
        const existing = byKey.get(existingKey)!;
        // Backfill missing fields from the duplicate; keep first-seen source.
        if (!existing.abstract && paper.abstract) existing.abstract = paper.abstract;
        if (existing.year === undefined && paper.year !== undefined)
          existing.year = paper.year;
        if (!existing.url && paper.url) existing.url = paper.url;
        if (
          existing.citationCount === undefined &&
          paper.citationCount !== undefined
        )
          existing.citationCount = paper.citationCount;
        if (existing.authors.length === 0 && paper.authors.length > 0)
          existing.authors = paper.authors;
        // Make the alternate key also point at this merged entry.
        if (dKey && !byKey.has(dKey)) byKey.set(dKey, existing);
        if (!byKey.has(titleKey)) byKey.set(titleKey, existing);
        continue;
      }

      // New paper: register under both available keys.
      byKey.set(titleKey, paper);
      if (dKey) byKey.set(dKey, paper);
      order.push(titleKey);
    }
  }

  return order.map((k) => byKey.get(k)!);
}

// ──────────────────────────────────────────────────────────────────────────
// Tool
// ──────────────────────────────────────────────────────────────────────────

export const literature_search = createTool({
  description:
    "Search scholarly literature across multiple sources (OpenAlex, arXiv; more " +
    "added over time). Use to check prior work, assess novelty, survey what is " +
    "already known in an area, and ground factual or scientific claims; cite the " +
    "returned papers. Each result includes title, authors, year, abstract, a URL, " +
    "and (when available) a citation count, tagged with the source it came from. " +
    "Prefer a focused, keyword-style query (key concepts, methods, or phenomena) " +
    "over a full sentence. By default all sources are queried concurrently and " +
    "results are merged and de-duplicated.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "A focused literature search query — key concepts, methods, or " +
          "phenomena (e.g. 'CRISPR base editing off-target effects'), not a " +
          "full natural-language question. This string drives source relevance " +
          "ranking, so make it specific.",
      ),
    sources: z
      .array(z.enum(SOURCE_IDS))
      .optional()
      .describe(
        "Which scholarly sources to query. Omit to search ALL available " +
          "sources (currently OpenAlex and arXiv) and merge the results. Pass a " +
          "subset (e.g. ['arxiv']) to restrict the search — e.g. arXiv for " +
          "preprints/CS/physics, OpenAlex for broad cross-discipline coverage.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(
        `How many papers to return PER SOURCE (default ${DEFAULT_LIMIT}, max ` +
          `${MAX_LIMIT}). Merged results across sources may be fewer after ` +
          `de-duplication.`,
      ),
  }),
  execute: async (_ctx, { query, sources, limit }): Promise<LiteratureSearchResult> => {
    const perSource = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Resolve the selected sources (default: all), preserving the registry order.
    const requested =
      sources && sources.length > 0
        ? SOURCE_IDS.filter((id) => sources.includes(id))
        : [...SOURCE_IDS];
    const selected = requested.length > 0 ? requested : [...SOURCE_IDS];

    const provider = selected.join("+");

    // Fan out concurrently; one source failing must not fail the tool.
    const settled = await Promise.allSettled(
      selected.map((id) => SOURCES[id](query, perSource)),
    );

    const groups: Paper[][] = [];
    const errors: string[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") {
        groups.push(outcome.value);
      } else {
        const reason =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        errors.push(`${selected[i]}: ${reason}`);
      }
    });

    const papers = mergeAndDedupe(groups);

    // Total failure: every selected source threw and we have nothing to show.
    if (papers.length === 0 && groups.length === 0 && errors.length > 0) {
      return {
        provider,
        query,
        papers: [],
        error: `All sources failed — ${errors.join("; ")}`,
      };
    }

    const result: LiteratureSearchResult = { provider, query, papers };
    // Surface partial failures so the model knows a source was skipped, but the
    // tool still succeeds with whatever came back.
    if (errors.length > 0) {
      result.error = `Some sources failed — ${errors.join("; ")}`;
    }
    return result;
  },
});
