"use client";

import { useRef } from "react";

export type Attachment = { id: string; name: string };

/** Unified composer: one rounded box with a textarea, a paperclip attach button
 * (bottom-left), and a circular send button (bottom-right). Pending attachments
 * show as chips inside the box. */
export function Composer({
  value,
  onChange,
  onSubmit,
  onPickFiles,
  attachments,
  onRemoveAttachment,
  placeholder,
  submitDisabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPickFiles: (files: FileList) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  placeholder?: string;
  submitDisabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-2xl border bg-card px-3 py-2.5 shadow-sm transition-colors focus-within:border-primary/60">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs"
            >
              <span className="max-w-[180px] truncate" title={a.name}>
                {a.name}
              </span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        rows={1}
        className="max-h-48 min-h-[44px] w-full resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />

      <div className="mt-1 flex items-center">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onPickFiles(e.target.files);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Attach data"
          title="Attach data"
        >
          <PaperclipIcon />
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
