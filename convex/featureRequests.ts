import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { feedback, agentKey } from "./feedbackClient";

const project = (i: any) => ({ _id: i._id, _creationTime: i._creationTime, title: i.title, description: i.description, state: i.state, voteCount: i.stats?.totalAmount ?? 0 });

export const submit = mutation({
  args: { title: v.string(), description: v.string() },
  returns: v.null(),
  handler: async (ctx, a) => { await feedback.items.create(ctx, { userId: "system", title: a.title, description: a.description, autoApprove: true }); return null; },
});
export const listPublic = query({
  args: { state: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const res: any = await feedback.items.listPublic(ctx, { limit: a.limit });
    return (res.page || []).map(project);
  },
});
export const listPending = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    // Gated read: if the agent key isn't set (e.g. anonymous local dev), the
    // component throws Unauthorized. Treat that as "nothing visible" rather
    // than letting an uncaught error spam the watched error log.
    try {
      const res: any = await feedback.items.listByState(ctx, { state: "requested", limit: a.limit, agentKey: agentKey() });
      return (res.page || []).map(project);
    } catch (e: any) {
      if (String(e?.message ?? e).includes("Unauthorized")) return [];
      throw e;
    }
  },
});
export const setState = mutation({
  args: { id: v.string(), state: v.string() },
  returns: v.null(),
  handler: async (ctx, a) => { await feedback.items.transitionState(ctx, { itemId: a.id as any, state: a.state as any }); return null; },
});
