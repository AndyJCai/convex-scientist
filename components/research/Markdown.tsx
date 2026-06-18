"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders the agent's markdown output (GFM: tables, lists, links, code) with
 * Tailwind-styled elements — no typography plugin / Tailwind config changes
 * needed, just per-element class overrides. Used for assistant messages.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="leading-relaxed" {...props} />,
          ul: (props) => <ul className="list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
          li: (props) => <li className="leading-relaxed" {...props} />,
          h1: (props) => <h1 className="mt-1 text-lg font-semibold" {...props} />,
          h2: (props) => <h2 className="mt-1 text-base font-semibold" {...props} />,
          h3: (props) => <h3 className="mt-1 text-sm font-semibold" {...props} />,
          a: (props) => (
            <a
              className="font-medium text-primary underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          img: (props) => (
            // Plain <img>: agent-rendered markdown images have arbitrary src/size,
            // so next/image isn't applicable. alt="" is overridden by props.alt.
            <img
              alt=""
              className="my-2 max-h-[480px] w-auto rounded-lg border"
              {...props}
            />
          ),
          strong: (props) => <strong className="font-semibold" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground"
              {...props}
            />
          ),
          code: ({ className, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            return isBlock ? (
              <code className={className} {...props} />
            ) : (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-xs"
                {...props}
              />
            );
          },
          pre: (props) => (
            <pre
              className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"
              {...props}
            />
          ),
          table: (props) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border px-2 py-1 text-left font-medium" {...props} />
          ),
          td: (props) => <td className="border px-2 py-1" {...props} />,
          hr: (props) => <hr className="my-2 border-border" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
