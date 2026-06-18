import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { feedback } from "./feedbackClient";
// Called from the passkey sign-in path: first user becomes admin (creator).
export const ensure = mutation({
  args: { userId: v.string() },
  returns: v.object({ userId: v.string(), role: v.union(v.literal("admin"), v.literal("member")) }),
  handler: (ctx, a) => feedback.users.ensure(ctx, a),
});
