import { defineApp } from "convex/server";
import feedback from "@convex-dev/feedback/convex.config";
const app = defineApp();
app.use(feedback);
export default app;
