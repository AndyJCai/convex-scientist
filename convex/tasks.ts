import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
  internalAction,
  QueryCtx,
} from "./_generated/server";
import { internal, components } from "./_generated/api";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import {
  listMessages as agentListMessages,
  listUIMessages as agentListUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { scientist, CACHED_SYSTEM } from "./scientist";

/**
 * Public surface for the AI-scientist chat spine. A *task* is one agent thread
 * (the base unit of work); it may optionally be grouped under a `projects`
 * folder (see convex/projects.ts).
 *
 *   createTask     (mutation) — auth; creates an agent thread + a tasks row.
 *   sendMessage    (action)   — auth + ownership; saves the user message and
 *                               streams the scientist's reply (with tool calls).
 *   listTasks      (query)    — the current user's tasks, newest first.
 *   renameTask     (mutation) — auth + ownership; sets a task's title.
 *   deleteTask     (mutation) — auth + ownership; cascade-deletes a task.
 *   listMessages   (query)    — paginated thread messages + live stream deltas.
 *   listUIMessages (query)    — same, pre-shaped as AI-SDK UIMessages (typed
 *                               parts) for easy inline tool-call card rendering.
 */

// ───────────────────────────── helpers ──────────────────────────────────────

/**
 * Assert the signed-in user owns the task backing `threadId`. Used by the
 * message queries so a user can only read their own thread. Throws otherwise.
 */
async function assertThreadOwner(ctx: QueryCtx, threadId: string) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not signed in.");
  }
  const task = await ctx.db
    .query("tasks")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
  if (!task || task.userId !== userId) {
    throw new Error("Not authorized for this thread.");
  }
  return userId;
}

/** Internal: ownership check usable from an action (which has no ctx.db). */
export const getTaskForOwner = internalQuery({
  args: { taskId: v.id("tasks"), userId: v.id("users") },
  returns: v.object({
    _id: v.id("tasks"),
    threadId: v.string(),
  }),
  handler: async (ctx, { taskId, userId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }
    if (task.userId !== userId) {
      throw new Error("Not authorized for this task.");
    }
    return { _id: task._id, threadId: task.threadId };
  },
});

// ───────────────────────────── mutations ────────────────────────────────────

export const createTask = mutation({
  args: { area: v.string() },
  returns: v.object({
    taskId: v.id("tasks"),
    threadId: v.string(),
  }),
  handler: async (ctx, { area }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in.");
    }
    // Create the agent thread for this task.
    // The Agent instance method returns { threadId, thread }.
    const { threadId } = await scientist.createThread(ctx, { userId });

    const trimmed = area.trim();
    // Initial title = the (clamped) area so the sidebar has something instantly.
    // A concise, human title is generated asynchronously by `generateTitle`
    // (scheduled below) and patched in when ready — never blocking creation.
    const initialTitle =
      trimmed.length > 80 ? trimmed.slice(0, 80).trimEnd() + "…" : trimmed;

    const taskId: Id<"tasks"> = await ctx.db.insert("tasks", {
      userId,
      title: initialTitle || "Untitled research",
      area: trimmed,
      threadId,
      state: "chat",
    });

    // Fire-and-forget: generate a nicer title with a cheap, fast model. Runs in
    // its own action transaction; any failure there leaves the initial title.
    if (trimmed.length > 0) {
      await ctx.scheduler.runAfter(0, internal.tasks.generateTitle, {
        taskId,
        area: trimmed,
      });
    }
    return { taskId, threadId };
  },
});

// ───────────────────────── thread management ────────────────────────────────

/**
 * Rename a task. Auth + ownership checked. Trims input, ignores an empty
 * title (no-op), and caps length to keep the sidebar tidy.
 */
export const renameTask = mutation({
  args: { taskId: v.id("tasks"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { taskId, title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in.");
    }
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }
    if (task.userId !== userId) {
      throw new Error("Not authorized for this task.");
    }

    const trimmed = title.trim();
    if (trimmed.length === 0) {
      // Ignore empty rename — keep the existing title.
      return null;
    }
    const MAX = 120;
    const capped =
      trimmed.length > MAX ? trimmed.slice(0, MAX).trimEnd() : trimmed;
    await ctx.db.patch(taskId, { title: capped });
    return null;
  },
});

/**
 * Delete a task and everything hanging off it. Auth + ownership checked.
 * Cascade order:
 *   1. Delete each artifact's stored blob, then the artifact rows.
 *   2. Best-effort delete the agent thread + all its messages/streams via
 *      `scientist.deleteThreadAsync` (recursive paged delete). A failure here
 *      is swallowed — it must never block removing the task.
 *   3. Delete the task row last.
 */
export const deleteTask = mutation({
  args: { taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in.");
    }
    const task = await ctx.db.get(taskId);
    if (!task) {
      // Idempotent: already gone is success.
      return null;
    }
    if (task.userId !== userId) {
      throw new Error("Not authorized for this task.");
    }

    // 1. Artifacts: delete the stored blob for each, then the rows.
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .take(1000);
    for (const artifact of artifacts) {
      await ctx.storage.delete(artifact.storageId);
      await ctx.db.delete(artifact._id);
    }

    // 2. Agent thread + messages/streams. `deleteThreadAsync` accepts a
    //    MutationCtx and recursively pages the delete in the background, so it
    //    won't blow the per-mutation write budget. Best-effort: never let a
    //    thread-deletion failure block removing the task row.
    try {
      await scientist.deleteThreadAsync(ctx, { threadId: task.threadId });
    } catch (err) {
      console.error(
        `deleteTask: failed to delete agent thread ${task.threadId} ` +
          `for task ${taskId}; leaving it orphaned.`,
        err,
      );
    }

    // 3. The task row last.
    await ctx.db.delete(taskId);
    return null;
  },
});

// ───────────────────────────── actions ──────────────────────────────────────

export const sendMessage = action({
  args: {
    taskId: v.id("tasks"),
    text: v.string(),
    // Artifacts uploaded in the composer that should be shown as attached to
    // THIS message (and stamped with its messageId so the chat renders them
    // inline in the user's bubble).
    attachmentIds: v.optional(v.array(v.id("artifacts"))),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, text, attachmentIds }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in.");
    }
    // Ownership check + fetch the threadId (an action has no db access).
    const { threadId } = await ctx.runQuery(internal.tasks.getTaskForOwner, {
      taskId,
      userId,
    });

    // Save the user's message to the thread first, so it appears immediately.
    const { messageId } = await scientist.saveMessage(ctx, {
      threadId,
      userId,
      prompt: text,
    });

    // Link any composer attachments to this saved message so the chat can
    // render them inline in the user's bubble (the messageId equals the UI
    // message id). Done before streaming so the attachment shows promptly.
    if (attachmentIds && attachmentIds.length > 0) {
      await ctx.runMutation(internal.artifacts.attachArtifactsToMessage, {
        taskId,
        userId,
        artifactIds: attachmentIds,
        messageId,
      });
    }

    // Make the agent aware of any uploaded data files on this task so it can
    // load them with the code tool (passing `artifactName`). Anthropic
    // rejects a `role: "system"` entry anywhere but the very start of the
    // messages array, so injecting the note as a mid-array system message 400s
    // on any turn that already has history. Instead we prepend the note to the
    // user prompt TEXT for THIS turn only, via `prompt`. Because `promptMessageId`
    // is also set, @convex-dev/agent uses `prompt` in place of the anchored
    // message and saves NO new input messages — so the clean user text saved
    // above is what shows in the UI/history, and the note never accumulates
    // turn-over-turn. When there are no artifacts we omit `prompt` entirely and
    // the saved message is used as-is (no note).
    const artifacts = await ctx.runQuery(
      internal.artifacts.listArtifactsForTask,
      { taskId, userId },
    );
    const promptOverride =
      artifacts.length > 0
        ? "[Available data files (analyze with the code tool, " +
          "passing the file name as `artifactName`): " +
          artifacts
            .map((a) => `${a.name} (${a.contentType}, ${a.size} bytes)`)
            .join("; ") +
          "]\n\n" +
          text
        : undefined;

    // Stream the scientist's reply, letting it call tools. Deltas are persisted
    // so reactive queries update the UI live. We anchor on the saved user
    // message via promptMessageId. One streamed turn fits the 10-min action
    // limit comfortably; the tool loop is bounded by stopWhen in the agent.
    // Pass the system prompt as a `SystemModelMessage[]` (instead of letting the
    // Agent fall back to its string `instructions`) so we can attach an Anthropic
    // ephemeral `cache_control` breakpoint to the system block. Because Anthropic
    // caches the prefix in order `tools → system → messages`, this single
    // breakpoint caches the WHOLE stable `tools + system` preamble that is
    // re-sent every turn — multi-turn threads then get cache hits (cheaper +
    // faster). CACHED_SYSTEM is built from the same INSTRUCTIONS the Agent uses,
    // so the prompt content is unchanged; only caching metadata is added.
    // NOTE on the cast: `@convex-dev/agent@0.6.4` types `system` as `string`
    // only (AgentPrompt.system), which intersects with the AI SDK's wider
    // `string | SystemModelMessage | SystemModelMessage[]` and narrows it back to
    // `string`. At RUNTIME the agent forwards `system` verbatim to the AI SDK's
    // `streamText` (which accepts the array form), so the array works — the
    // overly-narrow type is the only obstacle. We cast the single arg object to
    // keep everything else fully type-checked.
    const result = await scientist.streamText(
      ctx,
      { threadId, userId },
      {
        promptMessageId: messageId,
        prompt: promptOverride,
        // Cast only `system` (see note above); the rest stays type-checked.
        system: CACHED_SYSTEM as unknown as string,
      },
      { saveStreamDeltas: true },
    );

    // Drive the stream to completion so all deltas + the final message are
    // persisted before the action returns.
    await result.consumeStream();
    return null;
  },
});

// ───────────────────────────── auto-title ───────────────────────────────────

/** Cheap, fast model used only for one-shot title generation. */
const TITLE_MODEL = "claude-haiku-4-5";

/**
 * Sanitize a model-produced title: collapse to one line, strip wrapping quotes
 * and trailing punctuation, and cap the length. Returns "" if nothing usable
 * remains (caller leaves the existing title in that case).
 */
function sanitizeTitle(raw: string): string {
  let t = raw.replace(/[\r\n]+/g, " ").trim();
  // Strip a leading Markdown heading marker (e.g. "# Title" → "Title").
  t = t.replace(/^#+\s*/, "").trim();
  // Strip a single pair of wrapping quotes (straight or curly).
  t = t.replace(/^["'“”‘’](.*)["'“”‘’]$/, "$1").trim();
  // Drop any stray leading/trailing quote chars.
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  // Trim trailing sentence punctuation.
  t = t.replace(/[.,;:!?]+$/, "").trim();
  const MAX = 80;
  if (t.length > MAX) {
    t = t.slice(0, MAX).trimEnd();
  }
  return t;
}

/**
 * Internal: set a task's title. Used by `generateTitle` from its action.
 * No auth (server-only, scheduled). No-op if the task is gone.
 */
export const setTitle = internalMutation({
  args: { taskId: v.id("tasks"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { taskId, title }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      return null;
    }
    await ctx.db.patch(taskId, { title });
    return null;
  },
});

/**
 * Internal: generate a concise human title for a task from its research
 * `area`, using a cheap/fast model. Scheduled fire-and-forget from
 * `createTask`. Fully graceful: on ANY error (missing API key, model error,
 * empty/sanitized-away output) it logs and returns, leaving the initial title
 * untouched. Never throws — it must not break task creation.
 */
export const generateTitle = internalAction({
  args: { taskId: v.id("tasks"), area: v.string() },
  returns: v.null(),
  handler: async (ctx, { taskId, area }) => {
    const trimmed = area.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      const { text } = await generateText({
        model: anthropic(TITLE_MODEL),
        maxOutputTokens: 32,
        temperature: 0.3,
        prompt:
          "Give a concise 3-6 word title (Title Case, no quotes, no " +
          "punctuation at the ends) for a research investigation about: " +
          trimmed,
      });
      const title = sanitizeTitle(text);
      if (title.length === 0) {
        return null;
      }
      await ctx.runMutation(internal.tasks.setTitle, {
        taskId,
        title,
      });
    } catch (err) {
      // Graceful: keep the existing (area-derived) title.
      console.error(
        `generateTitle: failed to generate a title for task ${taskId}; ` +
          `keeping the initial title.`,
        err,
      );
    }
    return null;
  },
});

// ───────────────────────────── queries ──────────────────────────────────────

export const listTasks = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("tasks"),
      _creationTime: v.number(),
      title: v.string(),
      area: v.string(),
      threadId: v.string(),
      state: v.string(),
      projectId: v.optional(v.id("projects")),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const rows = await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      title: r.title,
      area: r.area,
      threadId: r.threadId,
      state: r.state,
      projectId: r.projectId,
    }));
  },
});

/**
 * Reactive thread messages, including tool-call steps, plus live stream deltas.
 *
 * Returns the raw paginated `MessageDoc`s (which include separate messages for
 * tool calls and tool results) merged with `streams` for in-flight deltas.
 * Shape: { page: MessageDoc[], isDone, continueCursor, streams }.
 * Designed to back the `useThreadMessages(..., { stream: true })` hook, which
 * converts to UIMessages on the client. If you'd rather render typed UI parts
 * directly, use `listUIMessages` below.
 */
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  handler: async (ctx, args) => {
    await assertThreadOwner(ctx, args.threadId);
    const paginated = await agentListMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});

/**
 * Same as `listMessages`, but each page item is a fully-formed AI-SDK
 * `UIMessage` (with typed `parts`, including `tool-<name>` parts that carry
 * `state` / `input` / `output`). Easiest shape for rendering inline tool-call
 * cards without client-side conversion.
 */
export const listUIMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  handler: async (ctx, args) => {
    await assertThreadOwner(ctx, args.threadId);
    const paginated = await agentListUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});
