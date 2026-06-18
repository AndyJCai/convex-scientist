import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { feedback } from "./feedbackClient";

export const plan = mutation({
  args: { items: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => { await feedback.todos.plan(ctx, args); return null; },
});
export const advance = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => { await feedback.todos.advance(ctx); return null; },
});
export const setStatus = mutation({
  args: { id: v.string(), status: v.union(v.literal("pending"), v.literal("active"), v.literal("done")) },
  returns: v.null(),
  handler: async (ctx, args) => { await feedback.todos.setStatus(ctx, args as any); return null; },
});
export const listAll = query({
  args: {},
  handler: (ctx) => feedback.todos.listAll(ctx),
});
