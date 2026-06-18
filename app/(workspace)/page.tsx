"use client";

import { useRouter } from "next/navigation";
import { NewResearch } from "@/components/research/panes";

/** `/` — the "new task" landing. Starting a task navigates to its own URL. */
export default function HomePage() {
  const router = useRouter();
  return (
    <NewResearch onStarted={({ taskId }) => router.push(`/tasks/${taskId}`)} />
  );
}
