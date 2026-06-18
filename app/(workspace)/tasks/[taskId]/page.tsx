"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Thread } from "@/components/research/panes";

/** `/tasks/:taskId` — a task's chat thread. The thread id is resolved from the
 * task list (a subscription shared with the sidebar, so no extra fetch cost). */
export default function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const tasks = useQuery(api.tasks.listTasks, {});
  const task = tasks?.find((t) => t._id === taskId);
  // Loading or unknown task: render a blank pane rather than flashing the landing.
  if (!task) return <div className="flex-1" />;
  return (
    <Thread
      key={task.threadId}
      active={{ taskId: task._id as Id<"tasks">, threadId: task.threadId }}
    />
  );
}
