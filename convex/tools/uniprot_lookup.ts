import { z } from "zod";
import { createTool } from "@convex-dev/agent";

/**
 * uniprot_lookup — the structural-biology HUB tool.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE FILE = ONE TOOL  (wraps the UniProt REST API; no key required)
 * ──────────────────────────────────────────────────────────────────────────
 * UniProt is the authoritative catalogue of proteins. This tool resolves a
 * protein NAME, GENE symbol, keyword, or UniProt ACCESSION into normalized
 * entries: the canonical accession, recommended protein name, gene(s),
 * organism, length, a (truncated) sequence, and a one-paragraph function blurb.
 *
 * WHY IT'S THE HUB: the `accession` it returns (e.g. "P38398") is the key the
 * downstream structural tools consume — `alphafold_lookup` (predicted 3D
 * structure by accession) and `pdb_search` (experimental structures). So the
 * agent typically calls this FIRST to pin down the exact protein, then feeds
 * the accession onward.
 *
 * KEYLESS + V8: the UniProtKB search endpoint needs no API key, and `fetch()`
 * is available in the default Convex (V8) runtime — so no `"use node"`, and the
 * tool calls out directly from `execute`.
 *
 * ROBUSTNESS: like `literature_search`, this tool NEVER throws. On a non-OK
 * response, a network error, or a parse failure it returns
 * `{ query, entries: [], error }` so the agent's turn survives and it can adapt
 * (retry with a different query, or fall back to another tool).
 *
 * CRITICAL — keep this output shape stable; the frontend ToolCallCard renders it
 * via its generic structured view (it reads `query` for the arg summary and
 * `entries` as the primary record list):
 *   { query: string, resolvedQuery?: string, entries: UniprotEntry[], error?: string }
 */

export type UniprotEntry = {
  /** Canonical UniProt accession (e.g. "P38398") — the key downstream tools use. */
  accession: string;
  /** Mnemonic entry name (e.g. "BRCA1_HUMAN"). */
  entryName?: string;
  /** Recommended (or, failing that, submitted/alternative) protein name. */
  proteinName?: string;
  /** Gene symbol(s), primary first. */
  genes?: string[];
  /** Source organism scientific name (+ common name when present). */
  organism?: string;
  /** Amino-acid length of the canonical sequence. */
  length?: number;
  /** True for Swiss-Prot (manually reviewed) entries; false for TrEMBL. */
  reviewed?: boolean;
  /** One-paragraph FUNCTION annotation (truncated). */
  function?: string;
  /** Canonical sequence, truncated to keep context small; see `length` for full size. */
  sequence?: string;
  /** Human-facing UniProt entry page. */
  url: string;
};

export type UniprotLookupResult = {
  /** Echo of the user's query — the card's arg summary reads this. */
  query: string;
  /** The actual UniProt query string sent (transparency/debugging). */
  resolvedQuery?: string;
  entries: UniprotEntry[];
  /** Present only when the lookup failed; the tool never throws. */
  error?: string;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_FUNCTION_CHARS = 600;
/** Cap returned sequence so a titin-sized protein can't blow up the context. */
const MAX_SEQUENCE_CHARS = 1500;

/** Fields we ask UniProtKB to return — keeps the payload small and predictable. */
const FIELDS = [
  "accession",
  "id",
  "protein_name",
  "gene_primary",
  "organism_name",
  "length",
  "cc_function",
  "sequence",
  "reviewed",
] as const;

/**
 * Official UniProt accession format. If the query IS an accession we search the
 * `accession:` field for an exact hit instead of a fuzzy free-text search.
 */
const ACCESSION_RE =
  /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

function truncate(text: string | null | undefined, max: number): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() + "…" : trimmed;
}

// ──────────────────────────────────────────────────────────────────────────
// UniProtKB JSON → UniprotEntry
// ──────────────────────────────────────────────────────────────────────────

type UniProtName = { value?: string | null } | null;
type UniProtResult = {
  primaryAccession?: string | null;
  uniProtkbId?: string | null;
  entryType?: string | null;
  proteinDescription?: {
    recommendedName?: { fullName?: UniProtName } | null;
    submissionNames?: Array<{ fullName?: UniProtName }> | null;
    alternativeNames?: Array<{ fullName?: UniProtName }> | null;
  } | null;
  genes?: Array<{
    geneName?: { value?: string | null } | null;
  }> | null;
  organism?: {
    scientificName?: string | null;
    commonName?: string | null;
  } | null;
  sequence?: { value?: string | null; length?: number | null } | null;
  comments?: Array<{
    commentType?: string | null;
    texts?: Array<{ value?: string | null }> | null;
  }> | null;
};

function pickProteinName(result: UniProtResult): string | undefined {
  const d = result.proteinDescription;
  return (
    d?.recommendedName?.fullName?.value ??
    d?.submissionNames?.[0]?.fullName?.value ??
    d?.alternativeNames?.[0]?.fullName?.value ??
    undefined
  ) || undefined;
}

function pickFunction(result: UniProtResult): string | undefined {
  const fn = (result.comments ?? []).find(
    (c) => c?.commentType === "FUNCTION",
  );
  const text = fn?.texts?.map((t) => t?.value ?? "").filter(Boolean).join(" ");
  return truncate(text, MAX_FUNCTION_CHARS);
}

function mapResult(result: UniProtResult): UniprotEntry | null {
  const accession = result.primaryAccession?.trim();
  if (!accession) return null;

  const genes = (result.genes ?? [])
    .map((g) => g?.geneName?.value ?? "")
    .filter((name): name is string => name.length > 0);

  const organism = result.organism
    ? [result.organism.scientificName, result.organism.commonName]
        .filter((s): s is string => !!s && s.length > 0)
        .join(" / ") || undefined
    : undefined;

  const fullSequence = result.sequence?.value ?? undefined;

  return {
    accession,
    entryName: result.uniProtkbId ?? undefined,
    proteinName: pickProteinName(result),
    genes: genes.length > 0 ? genes : undefined,
    organism,
    length: result.sequence?.length ?? undefined,
    reviewed: result.entryType
      ? result.entryType.toLowerCase().includes("reviewed")
      : undefined,
    function: pickFunction(result),
    sequence: truncate(fullSequence, MAX_SEQUENCE_CHARS),
    url: `https://www.uniprot.org/uniprotkb/${accession}/entry`,
  };
}

/** The organism / reviewed filters appended (via `AND`) to every query. */
function buildFilters(
  organism: string | undefined,
  reviewedOnly: boolean,
): string[] {
  const filters: string[] = [];
  if (organism && organism.trim()) {
    const o = organism.trim();
    filters.push(/^\d+$/.test(o) ? `organism_id:${o}` : `organism_name:${o}`);
  }
  if (reviewedOnly) filters.push("reviewed:true");
  return filters;
}

/**
 * Parse a JSON response defensively. The Convex runtime's `fetch` advertises
 * `Accept-Encoding: gzip` but can hand back the raw gzip bytes WITHOUT decoding
 * them, so `res.json()` throws on the 0x1f 0x8b gzip magic. We request
 * `identity` (see headers below) to avoid this; this fallback decompresses a
 * gzip body ourselves if one still slips through and the runtime exposes
 * `DecompressionStream` — otherwise it parses the bytes as received.
 */
async function parseJson(res: Response): Promise<unknown> {
  const raw = new Uint8Array(await res.arrayBuffer());
  const gzipped = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DStream: any = (globalThis as any).DecompressionStream;
  let bytes: Uint8Array = raw;
  if (gzipped && typeof DStream === "function") {
    const stream = new Response(raw).body!.pipeThrough(new DStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Run ONE UniProtKB search for `coreTerm` (already field-qualified, e.g.
 * `gene:BRCA1`, or free text) plus the shared filters. Returns normalized
 * entries; never throws.
 */
async function searchUniprot(
  coreTerm: string,
  filters: string[],
  size: number,
): Promise<{ resolvedQuery: string; entries: UniprotEntry[]; error?: string }> {
  const resolvedQuery = [coreTerm, ...filters].join(" AND ");
  const url = new URL("https://rest.uniprot.org/uniprotkb/search");
  url.searchParams.set("query", resolvedQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", String(size));
  url.searchParams.set("fields", FIELDS.join(","));

  try {
    const res = await fetch(url.toString(), {
      // Force an uncompressed body — the Convex runtime advertises gzip but does
      // not decode the response, which corrupts JSON parsing (see parseJson).
      headers: { Accept: "application/json", "Accept-Encoding": "identity" },
    });
    if (!res.ok) {
      return {
        resolvedQuery,
        entries: [],
        error: `UniProt returned HTTP ${res.status} ${res.statusText}.`,
      };
    }
    const body = (await parseJson(res)) as { results?: UniProtResult[] };
    const entries = (body.results ?? [])
      .map(mapResult)
      .filter((e): e is UniprotEntry => e !== null);
    return { resolvedQuery, entries };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      resolvedQuery,
      entries: [],
      error: `UniProt lookup failed: ${message}`,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tool
// ──────────────────────────────────────────────────────────────────────────

export const uniprot_lookup = createTool({
  description:
    "Look up proteins in UniProt by name, gene symbol, keyword, or UniProt " +
    "accession. Returns normalized entries with the canonical UniProt accession, " +
    "recommended protein name, gene(s), organism, length, a (truncated) amino-acid " +
    "sequence, and a one-paragraph function annotation. This is the hub for " +
    "structural-biology work: call it FIRST to pin down the exact protein, then " +
    "feed the returned `accession` to structure tools (e.g. AlphaFold/PDB lookups). " +
    "Defaults to Swiss-Prot (manually reviewed) entries for higher-quality results.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "The protein to look up: a protein name ('breast cancer type 1 " +
          "susceptibility protein'), a gene symbol ('BRCA1'), a free-text keyword, " +
          "or a UniProt accession ('P38398'). When the query is a valid accession " +
          "it is matched exactly; otherwise it is a relevance-ranked text search.",
      ),
    organism: z
      .string()
      .optional()
      .describe(
        "Optional organism filter — a scientific/common name ('Homo sapiens', " +
          "'human', 'mouse') or an NCBI taxon id ('9606'). Use to disambiguate a " +
          "gene symbol that exists across species.",
      ),
    reviewedOnly: z
      .boolean()
      .optional()
      .describe(
        "Restrict to Swiss-Prot (manually reviewed) entries. Defaults to true — " +
          "set false to also include unreviewed TrEMBL entries when a reviewed " +
          "entry does not exist for the protein.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe(
        `How many entries to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). ` +
          "Use 1 when you already know the exact protein/accession.",
      ),
  }),
  execute: async (
    _ctx,
    { query, organism, reviewedOnly, limit },
  ): Promise<UniprotLookupResult> => {
    const size = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const filters = buildFilters(organism, reviewedOnly ?? true);
    const q = query.trim();

    // 1. Exact accession lookup when the query IS an accession.
    if (ACCESSION_RE.test(q)) {
      const r = await searchUniprot(`accession:${q.toUpperCase()}`, filters, size);
      return {
        query,
        resolvedQuery: r.resolvedQuery,
        entries: r.entries,
        error: r.entries.length
          ? undefined
          : r.error ?? `No UniProt entry for accession "${q}".`,
      };
    }

    // 2. Single-token query (likely a gene symbol): match the GENE field first so
    //    e.g. "BRCA1" returns the canonical gene product (P38398), not a protein
    //    that merely mentions "BRCA1" in its name. Fall through to free text when
    //    the gene field matches nothing (e.g. "insulin", "hemoglobin", "kinase").
    if (!/\s/.test(q)) {
      const geneRes = await searchUniprot(`gene:${q}`, filters, size);
      if (geneRes.entries.length > 0) {
        return {
          query,
          resolvedQuery: geneRes.resolvedQuery,
          entries: geneRes.entries,
        };
      }
    }

    // 3. Free-text relevance search.
    const r = await searchUniprot(q, filters, size);
    return {
      query,
      resolvedQuery: r.resolvedQuery,
      entries: r.entries,
      error: r.entries.length
        ? undefined
        : r.error ?? `No UniProt entries matched "${query}".`,
    };
  },
});
