"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useThreadMessages, toUIMessages } from "@convex-dev/agent/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ToolCallCard, type Part } from "@/components/research/ToolCallCard";
import { Markdown } from "@/components/research/Markdown";
import { AskUserCard } from "@/components/research/AskUserCard";
import { Composer } from "@/components/research/Composer";
import { type Artifact } from "@/components/research/ArtifactBar";
import {
  TaskDrive,
  ProjectDrive,
  type DriveGroup,
} from "@/components/research/DriveTree";

export type TaskTarget = { taskId: Id<"tasks">; threadId: string };
type Msg = { id: string; key: string; role: string; parts: Part[] };

export function NewResearch({ onStarted }: { onStarted: (a: TaskTarget) => void }) {
  const createTask = useMutation(api.tasks.createTask);
  const sendMessage = useAction(api.tasks.sendMessage);
  const generateUploadUrl = useMutation(api.artifacts.generateUploadUrl);
  const addArtifact = useMutation(api.artifacts.addArtifact);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function start() {
    const area = text.trim();
    if (!area || busy) return;
    setBusy(true);
    try {
      const { taskId, threadId } = await createTask({ area });
      const attachmentIds: Id<"artifacts">[] = [];
      for (const file of files) {
        try {
          const url = await generateUploadUrl();
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (res.ok) {
            const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
            const id = await addArtifact({
              taskId,
              storageId,
              name: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
            });
            attachmentIds.push(id);
          }
        } catch {
          /* skip a failed file */
        }
      }
      onStarted({ taskId, threadId });
      void sendMessage({ taskId, text: area, attachmentIds });
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">
        What should we investigate?
      </h1>
      <p className="mb-6 text-center text-sm text-muted-foreground">
        Describe a research area or question — and optionally attach a dataset. The AI
        Scientist surveys the literature, grounds claims in real papers, and can analyze
        your data.
      </p>
      <div className="w-full">
        <Composer
          value={text}
          onChange={setText}
          onSubmit={() => void start()}
          onPickFiles={(fl) => setFiles((f) => [...f, ...Array.from(fl)])}
          attachments={files.map((f, i) => ({ id: String(i), name: f.name }))}
          onRemoveAttachment={(id) =>
            setFiles((arr) => arr.filter((_, j) => String(j) !== id))
          }
          placeholder="Describe a research area to investigate, or attach a dataset…"
          submitDisabled={busy || !text.trim()}
        />
      </div>
    </div>
  );
}

export function Thread({ active }: { active: TaskTarget }) {
  const sendMessage = useAction(api.tasks.sendMessage);
  const removeArtifact = useMutation(api.artifacts.removeArtifact);
  const generateUploadUrl = useMutation(api.artifacts.generateUploadUrl);
  const addArtifact = useMutation(api.artifacts.addArtifact);
  const artifacts = (useQuery(api.artifacts.listArtifacts, { taskId: active.taskId }) ??
    []) as Artifact[];
  const uploaded = artifacts.filter((a) => a.kind !== "generated");
  // Drive (right rail): all uploaded files are Inputs; generated files are
  // Outputs. (Distinct from `pending`/`attByMsg` below, which is the inline
  // chat-attachment view of the same uploads.)
  const outputs = artifacts.filter((a) => a.kind === "generated");
  // Pending = uploaded in the composer but not yet sent (no messageId). Sent
  // files carry the messageId of the user turn they went out with, and render
  // inline in that message bubble (grouped below).
  const pending = uploaded.filter((a) => !a.messageId);
  const attByMsg = new Map<string, Artifact[]>();
  for (const a of uploaded) {
    if (!a.messageId) continue;
    const arr = attByMsg.get(a.messageId);
    if (arr) arr.push(a);
    else attByMsg.set(a.messageId, [a]);
  }

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { results } = useThreadMessages(
    api.tasks.listMessages,
    { threadId: active.threadId },
    { initialNumItems: 50, stream: true },
  );
  const messages = toUIMessages(results ?? []) as unknown as Msg[];

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const last = messages[messages.length - 1];
  const lastText = last ? (last.parts ?? []).map((p) => p.text ?? "").join("") : "";
  useEffect(() => {
    if (stickRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, lastText]);
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const waiting = sending && last?.role === "user";

  // Only pending (unsent) files are removable — once attached to a sent
  // message they're part of the conversation history.
  function removeArtifactById(id: Id<"artifacts">) {
    void removeArtifact({ artifactId: id });
  }

  async function onPickFiles(files: FileList) {
    for (const file of Array.from(files)) {
      try {
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) continue;
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await addArtifact({
          taskId: active.taskId,
          storageId,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
      } catch {
        /* skip a failed file */
      }
    }
  }

  async function sendText(t: string, attachmentIds?: Id<"artifacts">[]) {
    if (!t || sending) return;
    setSending(true);
    stickRef.current = true;
    try {
      await sendMessage({ taskId: active.taskId, text: t, attachmentIds });
    } finally {
      setSending(false);
    }
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    await sendText(
      t,
      pending.map((a) => a._id),
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-6">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">Starting the conversation…</p>
            )}
            {messages.map((m, i) => (
              <MessageRow
                key={m.key}
                message={m}
                attachments={attByMsg.get(m.id) ?? []}
                isLast={i === messages.length - 1}
                onAnswer={sendText}
              />
            ))}
            {waiting && <ThinkingIndicator />}
          </div>
        </div>
        <div className="border-t">
          <div className="mx-auto max-w-2xl px-6 py-4">
            <Composer
              value={text}
              onChange={setText}
              onSubmit={() => void send()}
              onPickFiles={(files) => void onPickFiles(files)}
              attachments={pending.map((a) => ({ id: a._id, name: a.name }))}
              onRemoveAttachment={(id) => removeArtifactById(id as Id<"artifacts">)}
              placeholder="Ask a follow-up, or attach data…"
              submitDisabled={sending || !text.trim()}
            />
          </div>
        </div>
      </div>
      <aside className="hidden w-64 shrink-0 flex-col border-l xl:flex">
        <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Drive
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <TaskDrive inputs={uploaded} outputs={outputs} />
        </div>
      </aside>
    </div>
  );
}

/** The Project view: a folder's aggregated Drive. Each task shows its Inputs /
 * Outputs; the ＋ on a task opens a file picker that uploads into that task
 * (every artifact needs a task home — there are no loose project-level files). */
export function ProjectView({
  projectId,
  name,
  onOpenTask,
}: {
  projectId: Id<"projects">;
  name: string;
  onOpenTask: (taskId: Id<"tasks">) => void;
}) {
  const groups = (useQuery(api.artifacts.listArtifactsForProject, { projectId }) ??
    []) as DriveGroup[];
  const generateUploadUrl = useMutation(api.artifacts.generateUploadUrl);
  const addArtifact = useMutation(api.artifacts.addArtifact);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<Id<"tasks"> | null>(null);

  function pickFilesFor(taskId: Id<"tasks">) {
    uploadTargetRef.current = taskId;
    fileInputRef.current?.click();
  }
  async function onFilesChosen(fileList: FileList | null) {
    const taskId = uploadTargetRef.current;
    if (!taskId || !fileList) return;
    for (const file of Array.from(fileList)) {
      try {
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) continue;
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await addArtifact({
          taskId,
          storageId,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
      } catch {
        /* skip a failed file */
      }
    }
    uploadTargetRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const totalFiles = groups.reduce(
    (n, g) => n + g.inputs.length + g.outputs.length,
    0,
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <div className="mb-1 flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{name}</h1>
          <span className="text-xs text-muted-foreground">Drive</span>
        </div>
        <p className="mb-5 text-xs text-muted-foreground">
          {groups.length} {groups.length === 1 ? "task" : "tasks"} · {totalFiles}{" "}
          {totalFiles === 1 ? "file" : "files"} — inputs you upload and outputs the
          Convex Scientist generates, organized by task.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void onFilesChosen(e.target.files)}
        />
        <ProjectDrive
          groups={groups}
          onOpenTask={onOpenTask}
          onUploadToTask={pickFilesFor}
        />
      </div>
    </div>
  );
}

function MessageRow({
  message,
  attachments,
  isLast,
  onAnswer,
}: {
  message: Msg;
  attachments: Artifact[];
  isLast: boolean;
  onAnswer: (text: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {attachments.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {attachments.map((a) => (
              <AttachmentChip key={a._id} name={a.name} />
            ))}
          </div>
        )}
        <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {message.parts.map((part, i) =>
            part.type === "text" ? (
              <p key={i} className="whitespace-pre-wrap leading-relaxed">
                {part.text}
              </p>
            ) : null,
          )}
        </div>
      </div>
    );
  }

  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n\n")
    .trim();

  return (
    <div className="group flex flex-col gap-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return part.text ? <Markdown key={i}>{part.text}</Markdown> : null;
        }
        if (part.type === "tool-ask_user") {
          return <AskUserCard key={i} part={part} disabled={!isLast} onAnswer={onAnswer} />;
        }
        if (part.type.startsWith("tool-")) {
          return <ToolCallCard key={i} part={part} />;
        }
        return null;
      })}
      {textContent && (
        <div className="pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={textContent} />
        </div>
      )}
    </div>
  );
}

/** A file attached to a user message, rendered inline above the message bubble
 * as a compact card (icon + name) — like a chat attachment. */
function AttachmentChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-card-foreground shadow-sm">
      <FileIcon />
      <span className="truncate" title={name}>
        {name}
      </span>
    </span>
  );
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden />
      <span>Researching…</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
