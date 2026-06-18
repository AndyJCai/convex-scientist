import { components } from "./_generated/api";
import { Feedback } from "@convex-dev/feedback";

export const feedback = new Feedback(components.feedback);
// The wow-shell agent (CLI / deploy key) authenticates to gated reads with this
// key, provisioned once at scaffold time and set as a deployment env var.
// Read at CALL TIME (not module-load) so the key set after `convex dev` applies.
export const agentKey = () => process.env.FEEDBACK_AGENT_KEY;
