import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { feedback } from "./feedbackClient";

const vKind = v.union(v.literal("step"), v.literal("shipped"), v.literal("note"));

export const post = mutation({
  args: { message: v.string(), kind: v.optional(vKind) },
  returns: v.null(),
  handler: async (ctx, { message, kind }) => {
    await feedback.progress.post(ctx, { message, kind: kind ?? "step" });
    return null; // never return an id (avoids the todos:setStatus id mixup)
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: (ctx, args) => feedback.progress.listRecent(ctx, args),
});
