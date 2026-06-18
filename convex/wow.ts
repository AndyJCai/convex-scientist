import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { feedback } from "./feedbackClient";

const project = (i: any) => ({ _id: i._id, _creationTime: i._creationTime, title: i.title, description: i.description, state: i.state, voteCount: i.stats?.totalAmount ?? 0 });
const vViewer = v.optional(v.union(v.string(), v.null()));

// Panel build chrome (gated server-side): pass the signed-in viewer so admins
// see build status and members don't (no agentKey from the browser).
export const agentState = query({
  args: { viewer: vViewer },
  handler: (ctx, a) => feedback.agentState.snapshot(ctx, { viewer: a.viewer ?? null }),
});
export const listPublicItems = query({
  args: { viewer: vViewer },
  handler: async (ctx) => {
    const r: any = await feedback.items.listPublic(ctx, {});
    return (r.page || []).map(project);
  },
});
export const submitRequest = mutation({
  args: { title: v.string(), description: v.optional(v.string()), viewer: vViewer },
  returns: v.null(),
  handler: async (ctx, a) => { await feedback.items.create(ctx, { userId: a.viewer ?? "anon", title: a.title, description: a.description ?? "", autoApprove: true }); return null; },
});
export const upvoteRequest = mutation({
  args: { id: v.string(), viewer: vViewer },
  returns: v.null(),
  handler: async (ctx, a) => { await feedback.bids.place(ctx, { userId: a.viewer ?? "anon", itemId: a.id as any, amount: 1 }); return null; },
});
export const answerRefinement = mutation({
  args: { id: v.string(), answer: v.string(), viewer: vViewer },
  returns: v.null(),
  handler: async (ctx, a) => { await feedback.devLogs.post(ctx, { itemId: a.id as any, authorId: a.viewer ?? "user", message: a.answer }); return null; },
});
export const skipRefinement = mutation({
  args: { id: v.string(), viewer: vViewer },
  returns: v.null(),
  handler: async (ctx, a) => { await feedback.items.transitionState(ctx, { itemId: a.id as any, state: "rejected" }); return null; },
});
