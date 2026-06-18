import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";

/**
 * The client-facing shape of one artifact, shared by `listArtifacts` (per task)
 * and `listArtifactsForProject` (aggregated). The raw `storageId` is never
 * exposed; instead we resolve a `url` (via `ctx.storage.getUrl`) so the Drive
 * can preview images inline and let the user open/download any file. `url` is
 * null only if the blob is missing.
 */
const artifactSummary = v.object({
  _id: v.id("artifacts"),
  _creationTime: v.number(),
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
  kind: v.union(v.literal("uploaded"), v.literal("generated")),
  messageId: v.optional(v.string()),
  url: v.union(v.string(), v.null()),
});
type ArtifactSummary = {
  _id: Id<"artifacts">;
  _creationTime: number;
  name: string;
  contentType: string;
  size: number;
  kind: "uploaded" | "generated";
  messageId?: string;
  url: string | null;
};

/**
 * Public surface for task data-file artifacts.
 *
 *   generateUploadUrl (mutation) — auth; a short-lived URL the client POSTs the
 *                                  file to, getting back an Id<"_storage">.
 *   addArtifact       (mutation) — auth + ownership; records an UPLOADED file
 *                                  against a task.
 *   listArtifacts     (query)    — auth + ownership; the task's files,
 *                                  newest first (reactive).
 *   removeArtifact    (mutation) — auth + ownership; deletes the record AND the
 *                                  underlying stored blob.
 *
 * The bytes never live in this table — only the `storageId` + metadata. The
 * agent's code tool resolves a file by name (see
 * `getArtifactForThreadByName` below), fetches the blob from `ctx.storage`, and
 * stages it into the sandbox before running code. Generated charts are recorded
 * here too (kind "generated") via the internal `addGeneratedArtifact`.
 *
 * Everything is scoped to the signed-in user and re-checked against the owning
 * task's `userId`. We NEVER take a userId as an argument for authorization.
 */

// ───────────────────────────── helpers ──────────────────────────────────────

/**
 * Resolve the signed-in user, or throw. Centralizes the auth gate so every
 * mutation/query below fails the same way for an anonymous caller.
 */
async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not signed in.");
  }
  return userId;
}

/**
 * Fetch a task and assert the signed-in user owns it. Throws if the task is
 * missing or owned by someone else. Returns the task doc.
 */
async function requireOwnedTask(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
  userId: Id<"users">,
): Promise<Doc<"tasks">> {
  const task = await ctx.db.get(taskId);
  if (!task) {
    throw new Error("Task not found.");
  }
  if (task.userId !== userId) {
    throw new Error("Not authorized for this task.");
  }
  return task;
}

// ───────────────────────────── mutations ────────────────────────────────────

/**
 * Mint a one-time upload URL. The client POSTs the file bytes to this URL and
 * receives a `{ storageId }` back, which it then passes to `addArtifact`.
 */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Record an UPLOADED file against a task. Verifies the task belongs to the
 * caller before inserting. `storageId` comes from a prior upload to the URL
 * minted by `generateUploadUrl`.
 */
export const addArtifact = mutation({
  args: {
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.id("artifacts"),
  handler: async (ctx, { taskId, storageId, name, contentType, size }) => {
    const userId = await requireUser(ctx);
    await requireOwnedTask(ctx, taskId, userId);

    const trimmed = name.trim();
    const artifactId: Id<"artifacts"> = await ctx.db.insert("artifacts", {
      taskId,
      userId,
      name: trimmed || "data-file",
      storageId,
      contentType,
      size,
      kind: "uploaded",
    });
    return artifactId;
  },
});

/**
 * Remove an artifact: delete the table row AND the underlying stored blob (so
 * we don't leak storage). Ownership-checked against the artifact's task.
 */
export const removeArtifact = mutation({
  args: { artifactId: v.id("artifacts") },
  returns: v.null(),
  handler: async (ctx, { artifactId }) => {
    const userId = await requireUser(ctx);
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) {
      // Idempotent: already gone is success.
      return null;
    }
    // Re-derive ownership from the owning task (defense in depth; the row also
    // stores userId, but the task is the source of truth).
    await requireOwnedTask(ctx, artifact.taskId, userId);

    await ctx.storage.delete(artifact.storageId);
    await ctx.db.delete(artifactId);
    return null;
  },
});

// ───────────────────────────── queries ──────────────────────────────────────

/**
 * The task's artifacts, newest first. Reactive — backs an upload panel / file
 * list that updates live as files are added or removed. Ownership-checked; the
 * underlying `storageId` is intentionally NOT returned to the client (URLs
 * expire and the client doesn't need it — analysis happens server-side). `kind`
 * is returned so the UI can split uploaded inputs from generated outputs.
 */
export const listArtifacts = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(artifactSummary),
  handler: async (ctx, { taskId }) => {
    const userId = await requireUser(ctx);
    await requireOwnedTask(ctx, taskId, userId);

    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(200);
    return await Promise.all(
      rows.map(async (r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        name: r.name,
        contentType: r.contentType,
        size: r.size,
        kind: r.kind,
        messageId: r.messageId,
        url: await ctx.storage.getUrl(r.storageId),
      })),
    );
  },
});

/**
 * Project-level Drive: every artifact across the project's tasks, grouped by
 * task and split into uploaded *inputs* vs generated *outputs*. Auth + ownership
 * on the project. Files stay task-scoped (see schema) — this is a read
 * aggregation, NOT denormalization, so re-filing a task between folders needs no
 * artifact rewrites. Bounded reads: tasks `.take(1000)` (a folder won't
 * realistically exceed that) and artifacts `.take(200)` per task (matches
 * `listArtifacts`). Tasks newest-first; files newest-first within each bucket.
 * Tasks with no files are still returned so the project view can show the full
 * structure and offer an upload target per task.
 */
export const listArtifactsForProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      taskId: v.id("tasks"),
      title: v.string(),
      inputs: v.array(artifactSummary),
      outputs: v.array(artifactSummary),
    }),
  ),
  handler: async (ctx, { projectId }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== userId) {
      throw new Error("Not authorized for this project.");
    }

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(1000);

    const groups: Array<{
      taskId: Id<"tasks">;
      title: string;
      inputs: ArtifactSummary[];
      outputs: ArtifactSummary[];
    }> = [];
    for (const task of tasks) {
      const rows = await ctx.db
        .query("artifacts")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .order("desc")
        .take(200);
      const items: ArtifactSummary[] = await Promise.all(
        rows.map(async (r) => ({
          _id: r._id,
          _creationTime: r._creationTime,
          name: r.name,
          contentType: r.contentType,
          size: r.size,
          kind: r.kind,
          messageId: r.messageId,
          url: await ctx.storage.getUrl(r.storageId),
        })),
      );
      groups.push({
        taskId: task._id,
        title: task.title,
        inputs: items.filter((i) => i.kind !== "generated"),
        outputs: items.filter((i) => i.kind === "generated"),
      });
    }
    return groups;
  },
});

/**
 * Internal: stamp a set of uploaded artifacts with the agent message they were
 * sent with, so the chat can render them inline in that message bubble. Called
 * from `tasks.sendMessage` right after the user message is saved (it has the
 * `messageId`). Ownership is re-derived from the owning task; we only touch
 * artifacts that belong to this task and are still unattached (defense against
 * re-stamping an already-sent file).
 */
export const attachArtifactsToMessage = internalMutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.id("users"),
    artifactIds: v.array(v.id("artifacts")),
    messageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, userId, artifactIds, messageId }) => {
    await requireOwnedTask(ctx, taskId, userId);
    for (const artifactId of artifactIds) {
      const artifact = await ctx.db.get(artifactId);
      if (
        artifact &&
        artifact.taskId === taskId &&
        artifact.messageId === undefined
      ) {
        await ctx.db.patch(artifactId, { messageId });
      }
    }
    return null;
  },
});

// ─────────────────────────── internal (server-only) ─────────────────────────

/**
 * Internal: list a task's artifacts for injecting awareness into an agent turn
 * (see tasks.sendMessage). Ownership-checked against `userId` (passed from the
 * action after its own auth gate). Returns just what the context note needs.
 */
export const listArtifactsForTask = internalQuery({
  args: { taskId: v.id("tasks"), userId: v.id("users") },
  returns: v.array(
    v.object({
      name: v.string(),
      contentType: v.string(),
      size: v.number(),
    }),
  ),
  handler: async (ctx, { taskId, userId }) => {
    await requireOwnedTask(ctx, taskId, userId);
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("desc")
      .take(200);
    return rows.map((r) => ({
      name: r.name,
      contentType: r.contentType,
      size: r.size,
    }));
  },
});

/**
 * Internal: record a GENERATED artifact (e.g. a chart written by the
 * code tool) against a task, so it surfaces in the Drive alongside
 * uploaded files. Called server-side from the tool's action context after the
 * blob is already stored, so we re-derive ownership from the task and trust the
 * passed `userId` only as a stored field. The tool already resolved the task
 * for this thread; here we just verify the task exists and stamp the row.
 */
export const addGeneratedArtifact = internalMutation({
  args: {
    taskId: v.id("tasks"),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.id("artifacts"),
  handler: async (ctx, { taskId, storageId, name, contentType, size }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }
    const trimmed = name.trim();
    const artifactId: Id<"artifacts"> = await ctx.db.insert("artifacts", {
      taskId,
      userId: task.userId,
      name: trimmed || "chart",
      storageId,
      contentType,
      size,
      kind: "generated",
    });
    return artifactId;
  },
});

/**
 * Internal: resolve a single artifact by (threadId, name) for the code
 * tool. The ToolCtx carries `threadId` + `userId`; we map the thread to its
 * task, ownership-check, then find the named file. Name match is exact first,
 * then case-insensitive as a fallback so the model's spelling is forgiving.
 * Returns the storageId + metadata (the tool fetches the bytes).
 */
export const getArtifactForThreadByName = internalQuery({
  args: { threadId: v.string(), userId: v.id("users"), name: v.string() },
  returns: v.union(
    v.object({
      name: v.string(),
      storageId: v.id("_storage"),
      contentType: v.string(),
      size: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { threadId, userId, name }) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
    if (!task || task.userId !== userId) {
      return null;
    }
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .order("desc")
      .take(200);

    const wanted = name.trim();
    const exact = rows.find((r) => r.name === wanted);
    const match =
      exact ?? rows.find((r) => r.name.toLowerCase() === wanted.toLowerCase());
    if (!match) {
      return null;
    }
    return {
      name: match.name,
      storageId: match.storageId,
      contentType: match.contentType,
      size: match.size,
    };
  },
});

/**
 * Internal: resolve the task id (+ owner) backing a thread, for tools that need
 * to attach generated artifacts. Returns null if no task matches or the owner
 * doesn't match the caller's user.
 */
export const getTaskIdForThread = internalQuery({
  args: { threadId: v.string(), userId: v.id("users") },
  returns: v.union(v.id("tasks"), v.null()),
  handler: async (ctx, { threadId, userId }) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
    if (!task || task.userId !== userId) {
      return null;
    }
    return task._id;
  },
});
