import { defineApp } from "convex/server";
import feedback from "@convex-dev/feedback/convex.config";
import agent from "@convex-dev/agent/convex.config";
import sandbox from "@convex-dev/sandbox/convex.config.js";

const app = defineApp();
// Keep the existing feedback component (powers the live Chef panel).
app.use(feedback);
// Threads + messages + tool steps + streaming for the AI scientist chat.
app.use(agent);
// Remote code execution (Daytona / Fly Sprites) for the code tool.
// Mounting under httpPrefix "/sandbox/" exposes the component's own callback
// route at ${CONVEX_SITE_URL}/sandbox/callback (used only if a remote action
// calls back into Convex; plain runCode does not need it).
app.use(sandbox, { httpPrefix: "/sandbox/" });
export default app;
