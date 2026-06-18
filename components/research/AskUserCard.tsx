"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Part } from "@/components/research/ToolCallCard";

/** Sentinel label for the always-available free-text "Other" choice. Stored in
 * the selection state like any option label; replaced with the user's typed
 * text at submit time. */
const OTHER = "__other__";

/** Renders an `ask_user` tool call as interactive multiple-choice questions.
 * On submit, the selections are formatted to text and sent back via `onAnswer`
 * (the normal sendMessage path), which resumes the agent. Locked once a later
 * message exists (disabled) or after the user submits. */
export function AskUserCard({
  part,
  disabled,
  onAnswer,
}: {
  part: Part;
  disabled?: boolean;
  onAnswer: (text: string) => void;
}) {
  const questions = part.input?.questions ?? [];
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const locked = disabled || submitted;

  function toggle(qi: number, label: string, multi: boolean) {
    setSel((prev) => {
      const cur = prev[qi] ?? [];
      const next = multi
        ? cur.includes(label)
          ? cur.filter((l) => l !== label)
          : [...cur, label]
        : [label];
      return { ...prev, [qi]: next };
    });
  }

  // Resolve a question's raw selection labels into display text, replacing the
  // OTHER sentinel with the user's typed answer (dropping it if left blank).
  function resolved(qi: number): string[] {
    return (sel[qi] ?? []).flatMap((label) =>
      label === OTHER ? [other[qi]?.trim() || ""].filter(Boolean) : [label],
    );
  }

  function submit() {
    const lines = questions.map((q, qi) => {
      const chosen = resolved(qi);
      return `${q.header || q.question}: ${chosen.length ? chosen.join(", ") : "(no selection)"}`;
    });
    setSubmitted(true);
    onAnswer(lines.join("\n"));
  }

  const allAnswered =
    questions.length > 0 && questions.every((_, qi) => resolved(qi).length > 0);

  return (
    <div className="my-2 rounded-lg border bg-card">
      <div className="border-b px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        ask_user · please choose
      </div>
      <div className="space-y-4 px-4 py-3">
        {questions.map((q, qi) => (
          <fieldset key={qi} disabled={locked} className="space-y-2">
            {q.header && (
              <span className="inline-block rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                {q.header}
              </span>
            )}
            <div className="text-sm font-medium">{q.question}</div>
            <div className="space-y-1.5">
              {q.options.map((o, oi) => {
                const checked = (sel[qi] ?? []).includes(o.label);
                return (
                  <label
                    key={oi}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      checked ? "border-primary bg-accent/50" : "hover:bg-muted/50"
                    } ${locked ? "cursor-default opacity-70" : ""}`}
                  >
                    <input
                      type={q.multiSelect ? "checkbox" : "radio"}
                      name={`q-${part.toolCallId}-${qi}`}
                      checked={checked}
                      onChange={() => toggle(qi, o.label, !!q.multiSelect)}
                      className="mt-1 accent-primary"
                    />
                    <span>
                      <span className="font-medium">{o.label}</span>
                      {o.description && (
                        <span className="block text-xs text-muted-foreground">
                          {o.description}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
              {/* Always-available free-text escape hatch. */}
              {(() => {
                const checked = (sel[qi] ?? []).includes(OTHER);
                return (
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      checked ? "border-primary bg-accent/50" : "hover:bg-muted/50"
                    } ${locked ? "cursor-default opacity-70" : ""}`}
                  >
                    <input
                      type={q.multiSelect ? "checkbox" : "radio"}
                      name={`q-${part.toolCallId}-${qi}`}
                      checked={checked}
                      onChange={() => toggle(qi, OTHER, !!q.multiSelect)}
                      className="mt-1 accent-primary"
                    />
                    <span className="flex-1">
                      <span className="font-medium">Other</span>
                      {checked && (
                        <input
                          type="text"
                          autoFocus
                          value={other[qi] ?? ""}
                          disabled={locked}
                          onChange={(e) =>
                            setOther((prev) => ({ ...prev, [qi]: e.target.value }))
                          }
                          onClick={(e) => e.preventDefault()}
                          placeholder="Type your answer…"
                          className="mt-1.5 block w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                        />
                      )}
                    </span>
                  </label>
                );
              })()}
            </div>
          </fieldset>
        ))}
        {!locked && (
          <Button size="sm" disabled={!allAnswered} onClick={submit}>
            Submit answer
          </Button>
        )}
        {submitted && <div className="text-xs text-muted-foreground">Submitted ✓</div>}
        {disabled && !submitted && (
          <div className="text-xs text-muted-foreground">Answered.</div>
        )}
      </div>
    </div>
  );
}
