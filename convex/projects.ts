import { v } from "convex/values";
import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";

/**
 * Public surface for *projects* — folders that group tasks. A project has no
 * agent thread of its own; it only groups tasks (see convex/tasks.ts). Deleting
 * a project does NOT delete its tasks — they're simply un-grouped.
 *
 *   createProject       (mutation) — auth; creates an empty folder.
 *   listProjects        (query)    — the current user's folders, newest first.
 *   renameProject       (mutation) — auth + ownership; renames a folder.
 *   deleteProject       (mutation) — auth + ownership; un-groups its tasks,
 *                                    then deletes the folder row.
 *   assignTaskToProject (mutation) — auth + ownership (both task & project);
 *                                    set or clear a task's folder.
 *
 * Everything is scoped to the signed-in user. We NEVER take a userId as an
 * argument for authorization.
 */

// ───────────────────────────── helpers ──────────────────────────────────────

/** Resolve the signed-in user, or throw. */
async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not signed in.");
  }
  return userId;
}

/** Fetch a project and assert the signed-in user owns it. Throws otherwise. */
async function requireOwnedProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  if (project.userId !== userId) {
    throw new Error("Not authorized for this project.");
  }
  return project;
}

// ───────────────────────────── mutations ────────────────────────────────────

export const createProject = mutation({
  args: { name: v.string() },
  returns: v.id("projects"),
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    const trimmed = name.trim();
    const MAX = 120;
    const capped =
      trimmed.length > MAX ? trimmed.slice(0, MAX).trimEnd() : trimmed;
    const projectId: Id<"projects"> = await ctx.db.insert("projects", {
      userId,
      name: capped || "Untitled folder",
    });
    return projectId;
  },
});

export const renameProject = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, name }) => {
    const userId = await requireUser(ctx);
    await requireOwnedProject(ctx, projectId, userId);

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      // Ignore empty rename — keep the existing name.
      return null;
    }
    const MAX = 120;
    const capped =
      trimmed.length > MAX ? trimmed.slice(0, MAX).trimEnd() : trimmed;
    await ctx.db.patch(projectId, { name: capped });
    return null;
  },
});

/**
 * Delete a project (folder). Does NOT delete the tasks inside it — instead it
 * un-groups them (clears `projectId`), then deletes the folder row. Auth +
 * ownership checked.
 */
export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(projectId);
    if (!project) {
      // Idempotent: already gone is success.
      return null;
    }
    if (project.userId !== userId) {
      throw new Error("Not authorized for this project.");
    }

    // Un-group every task in this folder. `field: undefined` in a patch clears
    // the optional field. Bounded read (a folder won't realistically hold more
    // than the 16k read limit; cap at 1000 to be safe).
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(1000);
    for (const task of tasks) {
      await ctx.db.patch(task._id, { projectId: undefined });
    }

    await ctx.db.delete(projectId);
    return null;
  },
});

/**
 * Set or clear a task's folder. Pass a `projectId` to group the task under that
 * folder, or `null` to un-group it. Ownership-checked on BOTH the task and the
 * target project (a user can't file a task into someone else's folder).
 */
export const assignTaskToProject = mutation({
  args: {
    taskId: v.id("tasks"),
    projectId: v.union(v.id("projects"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, projectId }) => {
    const userId = await requireUser(ctx);

    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }
    if (task.userId !== userId) {
      throw new Error("Not authorized for this task.");
    }

    if (projectId === null) {
      // Clear the folder link.
      await ctx.db.patch(taskId, { projectId: undefined });
      return null;
    }

    // Assigning into a folder: the folder must exist and belong to the caller.
    await requireOwnedProject(ctx, projectId, userId);
    await ctx.db.patch(taskId, { projectId });
    return null;
  },
});

// ───────────────────────────── queries ──────────────────────────────────────

export const listProjects = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("projects"),
      _creationTime: v.number(),
      name: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      name: r.name,
    }));
  },
});
