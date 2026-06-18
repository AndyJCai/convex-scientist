import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Tracks the currently-published static-site version in a single row, so open
// tabs can show "a new version is available" the instant a re-publish lands.
// `node publish-convex-app.mjs` calls recordDeploy after a successful upload.
export const getCurrent = query({
  args: {},
  returns: v.union(
    v.object({ version: v.number(), deploymentName: v.string(), deployedAt: v.number() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const row = await ctx.db.query("appVersion").first();
    return row ? { version: row.version, deploymentName: row.deploymentName, deployedAt: row.deployedAt } : null;
  },
});

export const recordDeploy = mutation({
  args: { deploymentName: v.string() },
  returns: v.number(),
  handler: async (ctx, { deploymentName }) => {
    const row = await ctx.db.query("appVersion").first();
    if (row) {
      const version = row.version + 1;
      await ctx.db.patch(row._id, { version, deploymentName, deployedAt: Date.now() });
      return version;
    }
    await ctx.db.insert("appVersion", { version: 1, deploymentName, deployedAt: Date.now() });
    return 1;
  },
});
