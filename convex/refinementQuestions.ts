import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { feedback, agentKey } from "./feedbackClient";

// ask: the agent asks a clarifying question (a refinement item).
export const ask = mutation({
  args: { text: v.string(), description: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, a) => {
    await feedback.items.create(ctx, { userId: "system", title: a.text, description: a.description ?? "", kind: "refinement", autoApprove: true });
    return null;
  },
});
// answer: the user's reply is a devLog on the item (component model).
export const answer = mutation({
  args: { id: v.string(), answer: v.string(), viewer: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, a) => {
    await feedback.devLogs.post(ctx, { itemId: a.id as any, authorId: a.viewer ?? "user", message: a.answer });
    return null;
  },
});
export const skip = mutation({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, a) => { await feedback.items.transitionState(ctx, { itemId: a.id as any, state: "rejected" }); return null; },
});
// listOpen (gated): reshape component refinements → {_id,text,answer?,state} for the agent + panel.
export const listOpen = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    // Gated read. A MISSING key means FEEDBACK_AGENT_KEY was never set (e.g. the
    // first push failed before provisioning) — THROW a clear, identifiable error
    // so the agent's answer-poll loop sees a real failure instead of an empty
    // list it misreads as "the user already answered". Silent [] here is exactly
    // what made past runs falsely report "ANSWERED after 3s".
    if (!agentKey()) {
      throw new Error("FEEDBACK_AGENT_KEY not set — refinement reads are gated. Provision it: `npx convex run setupFeedback:provisionAgentKey` then `npx convex env set FEEDBACK_AGENT_KEY <key>`.");
    }
    const items: any[] = await feedback.items.listRefinementOpen(ctx, { limit: a.limit, agentKey: agentKey() });
    const out = [];
    for (const it of items) {
      const logs: any[] = await feedback.devLogs.listForItem(ctx, { itemId: it._id });
      const answer = logs.length ? logs[logs.length - 1].message : undefined;
      out.push({ _id: it._id, text: it.title, answer, state: answer ? "answered" : "open", askedAtMs: it._creationTime });
    }
    return out;
  },
});
