"use client";

import { useState } from "react";

export type Paper = {
  title: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  url?: string;
  citationCount?: number;
};

export type Question = {
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

// Loose shape covering a UIMessage's text parts and tool-* parts, so the same
// type flows from the message list into the cards. Tool parts carry
// `state`/`input`/`output`; the card branches on the output shape.
export type Part = {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  input?: {
    query?: string;
    code?: string;
    language?: string;
    artifactName?: string;
    questions?: Question[];
  };
  output?: {
    provider?: string;
    query?: string;
    papers?: Paper[];
    kind?: string;
    language?: string;
    code?: string;
    stdout?: string;
    stderr?: string;
    result?: string;
    images?: Array<{ url: string; alt?: string }>;
    error?: string;
    // Any other data tool (e.g. uniprot_lookup) returns its own keys; the
    // generic structured view reads them by convention.
    [key: string]: unknown;
  };
  errorText?: string;
};

// Output keys that are framework/meta, not data to render in the generic view.
const META_KEYS = new Set([
  "provider",
  "query",
  "resolvedQuery",
  "kind",
  "error",
  "images",
  "language",
  "code",
  "stdout",
  "stderr",
  "result",
  "papers",
]);

/**
 * Find the primary array-of-records in a tool's output (e.g. `entries` for
 * uniprot_lookup) so the generic view can render each record as a block.
 */
function getPrimaryRecords(
  out: Record<string, unknown>,
): { key: string; records: Array<Record<string, unknown>> } | null {
  for (const [k, v] of Object.entries(out)) {
    if (META_KEYS.has(k)) continue;
    if (
      Array.isArray(v) &&
      v.length > 0 &&
      typeof v[0] === "object" &&
      v[0] !== null
    ) {
      return { key: k, records: v as Array<Record<string, unknown>> };
    }
  }
  return null;
}

/** A tool invocation, styled like a console/code call. */
export function ToolCallCard({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  const name = part.type.replace(/^tool-/, "");
  const done = part.state === "output-available";
  const errored = part.state === "output-error" || !!part.output?.error;
  const out = part.output ?? {};
  const images = out.images ?? [];
  // `kind` is the reliable signal once output exists; the name covers the
  // pre-output "running…" state and old `data_analysis` parts persisted before
  // the rename to `code`.
  const isCodeExec =
    out.kind === "code-exec" ||
    name === "code" ||
    name.toLowerCase().includes("analysis");
  const isLiterature = Array.isArray(out.papers);
  // Generic data tools (uniprot_lookup, …): the primary list of records, if any.
  const primaryRecords =
    !isCodeExec && !isLiterature ? getPrimaryRecords(out) : null;

  const argSummary = isCodeExec
    ? part.input?.artifactName
      ? `artifact="${part.input.artifactName}"`
      : `language="${out.language ?? part.input?.language ?? "python"}"`
    : part.input?.query
      ? `query="${part.input.query}"`
      : out.query
        ? `query="${out.query}"`
        : "";

  const status = errored
    ? "error"
    : !done
      ? "running…"
      : isCodeExec
        ? images.length
          ? `${images.length} chart${images.length > 1 ? "s" : ""}`
          : "ok"
        : isLiterature
          ? `${out.papers?.length ?? 0} papers`
          : primaryRecords
            ? `${primaryRecords.records.length} result${primaryRecords.records.length > 1 ? "s" : ""}`
            : "ok";

  const statusClass = errored
    ? "bg-red-100 text-red-700"
    : !done
      ? "bg-muted text-muted-foreground"
      : "bg-primary/25 text-foreground";

  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-card font-mono">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50"
      >
        <span className="text-muted-foreground">▸</span>
        <span className="font-semibold">{name}</span>
        <span className="truncate text-muted-foreground">({argSummary})</span>
        <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] ${statusClass}`}>
          {status}
        </span>
        <span className="shrink-0 text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>

      {images.length > 0 && (
        <div className="grid gap-2 border-t px-3 py-3 sm:grid-cols-2">
          {images.map((img, i) => (
            <a key={i} href={img.url} target="_blank" rel="noreferrer" className="block">
              {/* sandbox-generated chart; arbitrary URL/size → plain img */}
              <img
                src={img.url}
                alt={img.alt ?? "generated figure"}
                className="max-h-80 w-full rounded-md border bg-white object-contain"
              />
            </a>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-xs">
          {!done && !errored && (
            <p className="text-muted-foreground">
              {isCodeExec
                ? "Executing code in the sandbox…"
                : isLiterature
                  ? "Searching the literature…"
                  : "Running the tool…"}
            </p>
          )}
          {out.error && <p className="text-red-600">{out.error}</p>}
          {errored && !out.error && (
            <p className="text-red-600">{part.errorText ?? "The tool returned an error."}</p>
          )}

          {isCodeExec ? (
            <CodeExecView input={part.input} output={out} />
          ) : isLiterature ? (
            (out.papers ?? []).map((p, i) => <PaperRow key={i} paper={p} />)
          ) : (
            <GenericDataView output={out} />
          )}
        </div>
      )}
    </div>
  );
}

function PaperRow({ paper: p }: { paper: Paper }) {
  return (
    <div className="border-l-2 border-primary/50 pl-3 font-sans">
      {p.url ? (
        <a href={p.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {p.title}
        </a>
      ) : (
        <span className="font-medium">{p.title}</span>
      )}
      <div className="mt-0.5 text-xs text-muted-foreground">
        {(p.authors ?? []).slice(0, 3).join(", ")}
        {(p.authors?.length ?? 0) > 3 ? " et al." : ""}
        {p.year ? ` · ${p.year}` : ""}
        {typeof p.citationCount === "number" ? ` · ${p.citationCount} cites` : ""}
      </div>
      {p.abstract && (
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{p.abstract}</p>
      )}
    </div>
  );
}

function CodeExecView({
  input,
  output,
}: {
  input?: Part["input"];
  output: NonNullable<Part["output"]>;
}) {
  const code = output.code ?? input?.code ?? "";
  return (
    <div className="space-y-3">
      {code && (
        <Block label="code">
          <pre className="max-h-72 overflow-auto rounded-md bg-foreground/90 p-3 text-xs text-background">
            {code}
          </pre>
        </Block>
      )}
      {output.stdout && (
        <Block label="stdout">
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {output.stdout}
          </pre>
        </Block>
      )}
      {output.stderr && (
        <Block label="stderr">
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs text-red-600">
            {output.stderr}
          </pre>
        </Block>
      )}
      {output.result && (
        <Block label="result">
          <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
            {output.result}
          </pre>
        </Block>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Generic structured view ────────────────────────────────────────────────
// Renders any data tool's output without bespoke code: a primary list of
// records as labeled blocks, falling back to key/value rows, then raw JSON.

const TITLE_KEYS = ["title", "name", "proteinName", "label", "accession", "id"];
const URL_KEYS = ["url", "link", "href"];

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).filter(Boolean).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function KVRow({ name, value }: { name: string; value: unknown }) {
  const formatted = formatValue(value);
  if (!formatted) return null;
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{name}: </span>
      <span className="whitespace-pre-wrap break-words">{formatted}</span>
    </div>
  );
}

function RecordBlock({ record }: { record: Record<string, unknown> }) {
  const titleKey = TITLE_KEYS.find((k) => formatValue(record[k]));
  const urlKey = URL_KEYS.find((k) => typeof record[k] === "string" && record[k]);
  const title = titleKey ? formatValue(record[titleKey]) : undefined;
  const url = urlKey ? (record[urlKey] as string) : undefined;
  const rest = Object.entries(record).filter(
    ([k]) => k !== titleKey && k !== urlKey,
  );

  return (
    <div className="border-l-2 border-primary/50 pl-3 font-sans">
      {title &&
        (url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:underline"
          >
            {title}
          </a>
        ) : (
          <span className="font-medium">{title}</span>
        ))}
      <div className="mt-0.5 space-y-0.5">
        {rest.map(([k, v]) => (
          <KVRow key={k} name={k} value={v} />
        ))}
      </div>
    </div>
  );
}

function GenericDataView({ output }: { output: Record<string, unknown> }) {
  const primary = getPrimaryRecords(output);
  if (primary) {
    return (
      <div className="space-y-3">
        {primary.records.map((r, i) => (
          <RecordBlock key={i} record={r} />
        ))}
      </div>
    );
  }

  // No record list — render top-level scalar fields, else raw JSON.
  const scalars = Object.entries(output).filter(
    ([k, v]) => !META_KEYS.has(k) && (typeof v !== "object" || v === null),
  );
  if (scalars.length > 0) {
    return (
      <div className="space-y-0.5 font-sans">
        {scalars.map(([k, v]) => (
          <KVRow key={k} name={k} value={v} />
        ))}
      </div>
    );
  }

  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}
