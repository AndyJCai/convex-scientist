"use client";

import { useEffect, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { Artifact } from "@/components/research/ArtifactBar";

/**
 * The Drive's file-organization tree. Two contexts, one vocabulary:
 *
 *   • TASK view  → `<TaskDrive>`     — one task's files, split Inputs / Outputs.
 *   • PROJECT view → `<ProjectDrive>` — every task in the folder, each with its
 *                                       own Inputs / Outputs, plus an upload
 *                                       target per task.
 *
 * "Inputs" = uploaded datasets (`kind !== "generated"`); "Outputs" = files the
 * agent produced (`kind === "generated"`). Outputs are read-only here; inputs
 * are added via the composer (task view) or the per-task upload button (project
 * view). Display only — no delete, so a sent dataset can't be yanked out from
 * under the conversation that references it.
 */

// contentType → a coarse category + glyph, for a quick visual read of outputs.
function fileGlyph(contentType: string): string {
  if (contentType.startsWith("image/")) return "🖼";
  if (
    contentType.includes("csv") ||
    contentType.includes("tab-separated") ||
    contentType.includes("spreadsheet") ||
    contentType.includes("excel")
  )
    return "📊";
  if (contentType.includes("json")) return "🧾";
  return "📄";
}

function prettySize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(contentType: string): boolean {
  return contentType.startsWith("image/");
}

/** A full-screen, in-page image preview. Closes on backdrop click or Escape;
 * offers a download and an "open in new tab" escape hatch for the full blob. */
function ImageLightbox({
  file,
  url,
  onClose,
}: {
  file: Artifact;
  url: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 backdrop-blur-sm"
    >
      <img
        src={url}
        alt={file.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-3 text-xs text-white/90"
      >
        <span className="max-w-[40vw] truncate" title={file.name}>
          {file.name}
        </span>
        <a
          href={url}
          download={file.name}
          className="rounded bg-white/15 px-2 py-1 hover:bg-white/25"
        >
          Download
        </a>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded bg-white/15 px-2 py-1 hover:bg-white/25"
        >
          Open in new tab
        </a>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-white/15 px-2 py-1 hover:bg-white/25"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** A file row. Images open an in-page preview on click; other files open the
 * blob in a new tab (and offer download). Rows without a resolved `url` (blob
 * missing) fall back to a non-clickable row. */
function FileRow({ file }: { file: Artifact }) {
  const [previewing, setPreviewing] = useState(false);
  const previewable = Boolean(file.url) && isImage(file.contentType);

  const thumb =
    file.url && isImage(file.contentType) ? (
      <img
        src={file.url}
        alt=""
        loading="lazy"
        className="h-7 w-7 shrink-0 rounded border object-cover"
      />
    ) : (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-muted text-sm"
        aria-hidden
      >
        {fileGlyph(file.contentType)}
      </span>
    );

  const inner = (
    <>
      {thumb}
      <span className="min-w-0 flex-1 truncate text-xs" title={file.name}>
        {file.name}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {prettySize(file.size)}
      </span>
    </>
  );

  if (!file.url) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1 opacity-60">
        {inner}
      </div>
    );
  }

  if (previewable) {
    return (
      <>
        <button
          type="button"
          onClick={() => setPreviewing(true)}
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted"
          title={`Preview ${file.name}`}
        >
          {inner}
        </button>
        {previewing && (
          <ImageLightbox
            file={file}
            url={file.url}
            onClose={() => setPreviewing(false)}
          />
        )}
      </>
    );
  }

  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      download={file.name}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
      title={`Open / download ${file.name}`}
    >
      {inner}
    </a>
  );
}

/** A labelled file group. Renders nothing when empty — the Drive stays "closed"
 * unless there's actually something to show. */
function Section({
  icon,
  label,
  files,
}: {
  icon: string;
  label: string;
  files: Artifact[];
}) {
  if (files.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span aria-hidden>{icon}</span>
        <span>{label}</span>
        <span className="text-muted-foreground/60">{files.length}</span>
      </div>
      {files.map((f) => (
        <FileRow key={f._id} file={f} />
      ))}
    </div>
  );
}

/** One task's Drive: Inputs over Outputs. Empty sections are omitted; a fully
 * empty Drive shows a single quiet hint rather than two empty placeholders. */
export function TaskDrive({
  inputs,
  outputs,
}: {
  inputs: Artifact[];
  outputs: Artifact[];
}) {
  if (inputs.length === 0 && outputs.length === 0) {
    return (
      <p className="px-1.5 py-1 text-[11px] text-muted-foreground/70">
        No files yet — datasets you upload and outputs the Convex Scientist generates
        appear here.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <Section icon="📥" label="Inputs" files={inputs} />
      <Section icon="📤" label="Outputs" files={outputs} />
    </div>
  );
}

export type DriveGroup = {
  taskId: Id<"tasks">;
  title: string;
  inputs: Artifact[];
  outputs: Artifact[];
};

/** A project's aggregated Drive: each task as a collapsible-free block with its
 * own Inputs / Outputs, an upload target, and a click-through to open the task. */
export function ProjectDrive({
  groups,
  onOpenTask,
  onUploadToTask,
}: {
  groups: DriveGroup[];
  onOpenTask: (taskId: Id<"tasks">) => void;
  onUploadToTask: (taskId: Id<"tasks">) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="px-2 py-4 text-xs text-muted-foreground">
        No tasks in this project yet. Tasks you file here show their datasets and
        generated outputs in this Drive.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.taskId} className="rounded-lg border">
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <button
              type="button"
              onClick={() => onOpenTask(g.taskId)}
              className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline"
              title={g.title || "Untitled task"}
            >
              📂 {g.title || "Untitled task"}
            </button>
            <button
              type="button"
              onClick={() => onUploadToTask(g.taskId)}
              className="shrink-0 rounded px-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Upload a file to this task"
              title="Upload a file to this task"
            >
              ＋
            </button>
          </div>
          <div className="space-y-2 p-1.5">
            <TaskDrive inputs={g.inputs} outputs={g.outputs} />
          </div>
        </div>
      ))}
    </div>
  );
}
