import { v } from "convex/values";
import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
// Feedback tables live in the @convex-dev/feedback component, not here.
// Threads, messages, and tool-call steps live in the @convex-dev/agent component.
export default defineSchema({
  appVersion: defineTable({
    version: v.number(),
    deploymentName: v.string(),
    deployedAt: v.number(),
  }),
  // A task == one agent thread (the base unit of work). A task may optionally
  // belong to a `projects` folder (pure grouping). Fields carry over from the
  // former `projects` table unchanged; `projectId` is the optional folder link.
  tasks: defineTable({
    userId: v.id("users"),
    title: v.string(),
    area: v.string(),
    // The @convex-dev/agent thread id (an opaque string, not a Convex doc id).
    threadId: v.string(),
    // Research lifecycle state. "chat" for this slice; widens to triage/hypothesis/etc later.
    state: v.string(),
    // Optional folder this task is grouped under. Null/absent = ungrouped.
    projectId: v.optional(v.id("projects")),
  })
    .index("by_user", ["userId"])
    .index("by_thread", ["threadId"])
    .index("by_project", ["projectId"]),
  // Projects are folders that group tasks. They have no thread of their own —
  // grouping only. Deleting a folder does NOT delete its tasks (they're just
  // un-grouped).
  projects: defineTable({
    userId: v.id("users"),
    name: v.string(),
  }).index("by_user", ["userId"]),
  // Uploaded or generated data files attached to a task. The bytes live in
  // Convex file storage (`_storage`); we keep only the storageId + metadata
  // here so the agent's code tool can fetch and load them into the
  // sandbox by name, and so generated charts surface in the Drive. Scoped to
  // the task's owner.
  artifacts: defineTable({
    taskId: v.id("tasks"),
    userId: v.id("users"),
    name: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
    // How the file came to exist: "uploaded" by the user, or "generated" by a
    // tool run (e.g. a chart written by the code tool).
    kind: v.union(v.literal("uploaded"), v.literal("generated")),
    // The agent message this file was sent with (the `messageId` returned by
    // saveMessage, which equals the UI message id). Set when the user sends the
    // message carrying these attachments, so the chat can render the file inline
    // in that message bubble. Absent = still pending in the composer (uploaded
    // but not yet sent), or a generated artifact.
    messageId: v.optional(v.string()),
  }).index("by_task", ["taskId"]),
  ...authTables,
});
