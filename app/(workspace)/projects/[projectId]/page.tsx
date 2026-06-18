"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ProjectView } from "@/components/research/panes";

/** `/projects/:projectId` — a project's aggregated Drive. */
export default function ProjectPage() {
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  const projects = useQuery(api.projects.listProjects, {});
  const project = projects?.find((p) => p._id === projectId);
  if (!project) return <div className="flex-1" />;
  return (
    <ProjectView
      key={project._id}
      projectId={project._id as Id<"projects">}
      name={project.name}
      onOpenTask={(taskId) => router.push(`/tasks/${taskId}`)}
    />
  );
}
