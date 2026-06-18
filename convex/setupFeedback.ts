import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { feedback } from "./feedbackClient";

// Provision the agent key once at scaffold time; the bootstrap captures the
// returned key and sets it as FEEDBACK_AGENT_KEY on the deployment.
export const provisionAgentKey = mutation({
  args: {},
  returns: v.any(),
  handler: async (ctx) => feedback.agentKeys.create(ctx, { name: "wow-agent", adminUserId: "system" }),
});
