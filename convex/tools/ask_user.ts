import { z } from "zod";
import { createTool } from "@convex-dev/agent";

/**
 * ask_user — human-in-the-loop clarification tool.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE FILE = ONE TOOL  (interactive, NOT a data tool)
 * ──────────────────────────────────────────────────────────────────────────
 * Instead of guessing when intent is ambiguous (which dataset? which params?
 * what scope?), the agent calls this tool with 1–4 multiple-choice questions.
 * The questions ride on the tool-call INPUT (`part.input.questions`), which the
 * frontend renders as an interactive form (a chip header per question, a prompt,
 * and selectable options). The user's selection comes back as a normal chat
 * message on the NEXT turn — so this tool's job is simply to PAUSE the run.
 *
 * Because the value the agent needs lives in the *user's* later reply (not in
 * this tool's result), `execute` deliberately returns a minimal sentinel and
 * does NOT echo the questions/options back. Echoing them would invite the model
 * to keep going and answer on the user's behalf — the exact opposite of the
 * intent. The agent is instructed (here and in the system preamble) to STOP
 * after calling this tool and wait for the user's selection.
 *
 * CRITICAL — keep this output shape stable; the frontend uses the tool-call
 * INPUT (`part.input.questions`, frontend part type `tool-ask_user`) to render
 * the question/options UI, and uses this RESULT only to know the turn paused:
 *   { kind: "ask-user", status: "awaiting_user" }
 */

export type AskUserResult = {
  kind: "ask-user";
  status: "awaiting_user";
};

export const ask_user = createTool({
  description:
    "Ask the user to make a decision or clarify an ambiguous point, presenting " +
    "1–4 questions each with 2–4 options. Use this instead of guessing when the " +
    "right path depends on the user's intent/data (which dataset or file to use, " +
    "which parameters, the scope of the analysis, conflicting goals, etc.). " +
    "After calling it, STOP and wait for their answer — do not answer on their " +
    "behalf, and do not continue with other tools or a final response in the " +
    "same turn. The questions you pass are rendered to the user as an " +
    "interactive multiple-choice form in the chat.",
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          header: z
            .string()
            .describe(
              "A very short chip/label for this question (≤ ~12 characters), " +
                "e.g. 'Dataset', 'Scope', 'Metric'. Shown as a compact tag " +
                "above the question — keep it to one or two words.",
            ),
          question: z
            .string()
            .describe(
              "The full clarifying question to show the user, phrased clearly " +
                "and specifically (e.g. 'Which dataset should I analyze?'). " +
                "Ask about ONE decision per question.",
            ),
          options: z
            .array(
              z.object({
                label: z
                  .string()
                  .describe(
                    "Short, selectable answer text shown on the option button " +
                      "(e.g. 'sales_2024.csv', 'Use all data', 'Mean'). Keep it " +
                      "concise — this is the choice the user clicks.",
                  ),
                description: z
                  .string()
                  .optional()
                  .describe(
                    "Optional one-line elaboration shown under the label to " +
                      "explain the trade-off or detail of this choice. Omit " +
                      "when the label is self-explanatory.",
                  ),
              }),
            )
            .min(2)
            .max(4)
            .describe(
              "The 2–4 distinct, mutually-clear choices for this question. " +
                "Make them cover the realistic options so the user rarely needs " +
                "to type a free-form answer.",
            ),
          multiSelect: z
            .boolean()
            .optional()
            .describe(
              "Set true when the user may pick MORE THAN ONE option for this " +
                "question (e.g. 'Which metrics?'). Defaults to single-select " +
                "(pick exactly one) when omitted.",
            ),
        }),
      )
      .min(1)
      .max(4)
      .describe(
        "The 1–4 questions to ask the user, each a single decision with 2–4 " +
          "options. Group only genuinely related decisions together; prefer " +
          "fewer, well-targeted questions.",
      ),
  }),
  // Do NOT answer the question or echo the options — that would invite the model
  // to keep going. Return only a sentinel signalling the turn should pause; the
  // real answer arrives as the user's next message.
  execute: async (): Promise<AskUserResult> => {
    return { kind: "ask-user", status: "awaiting_user" };
  },
});
