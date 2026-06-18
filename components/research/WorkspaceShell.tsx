"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { PasskeyButton } from "@/components/PasskeyButton";

type Task = {
  _id: Id<"tasks">;
  _creationTime: number;
  title: string;
  area: string;
  threadId: string;
  state: string;
  projectId?: Id<"projects">;
};
type Project = { _id: Id<"projects">; _creationTime: number; name: string };
type Editing = { kind: "task" | "project"; id: string } | null;

/** Clean a display title: strip any leading Markdown heading marker ("# x" → "x"). */
function cleanTitle(s: string) {
  return s.replace(/^#+\s*/, "");
}

function relTime(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** The persistent workspace chrome: top bar + left sidebar (tasks & projects).
 * Lives in the route-group layout so it does NOT remount as you navigate between
 * `/`, `/tasks/:id` and `/projects/:id` — the sidebar's edit/scroll state persists.
 * The open task/project is read from the URL via `useParams`, so each one has its
 * own address that survives a refresh. The main pane is rendered as `children`. */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams<{ taskId?: string; projectId?: string }>();
  const activeTaskId = params.taskId as Id<"tasks"> | undefined;
  const activeProjectId = params.projectId as Id<"projects"> | undefined;

  const tasks = (useQuery(api.tasks.listTasks, {}) ?? []) as Task[];
  const projects = (useQuery(api.projects.listProjects, {}) ?? []) as Project[];

  const renameTask = useMutation(api.tasks.renameTask);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const createProject = useMutation(api.projects.createProject);
  const renameProject = useMutation(api.projects.renameProject);
  const deleteProject = useMutation(api.projects.deleteProject);
  const assignTaskToProject = useMutation(api.projects.assignTaskToProject);

  const [editing, setEditing] = useState<Editing>(null);
  const [editText, setEditText] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Inline "new project" composer. When `creatingProject` is on, an input
  // replaces the "+ New project" button. If `pendingAssignTaskId` is set, the
  // task is filed into the project as soon as it's created (the "New project…"
  // flow from a task's Move-to menu).
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingAssignTaskId, setPendingAssignTaskId] =
    useState<Id<"tasks"> | null>(null);

  const ungrouped = tasks.filter((t) => !t.projectId);

  function commitRename() {
    const val = editText.trim();
    const e = editing;
    setEditing(null);
    if (!e || !val) return;
    if (e.kind === "task") void renameTask({ taskId: e.id as Id<"tasks">, title: val });
    else void renameProject({ projectId: e.id as Id<"projects">, name: val });
  }

  async function onDeleteTask(t: Task) {
    if (!window.confirm(`Delete "${t.title || t.area}"? This removes the thread and its data.`))
      return;
    if (activeTaskId === t._id) router.push("/");
    await deleteTask({ taskId: t._id });
  }
  async function onDeleteProject(p: Project) {
    if (!window.confirm(`Delete project "${p.name}"? Its tasks are kept (ungrouped).`)) return;
    if (activeProjectId === p._id) router.push("/");
    await deleteProject({ projectId: p._id });
  }
  function startNewProject() {
    setPendingAssignTaskId(null);
    setNewProjectName("");
    setCreatingProject(true);
  }
  function moveToNewProject(taskId: Id<"tasks">) {
    setPendingAssignTaskId(taskId);
    setNewProjectName("");
    setCreatingProject(true);
  }
  function cancelNewProject() {
    setCreatingProject(false);
    setPendingAssignTaskId(null);
    setNewProjectName("");
  }
  async function commitNewProject() {
    const name = newProjectName.trim();
    const taskId = pendingAssignTaskId;
    cancelNewProject();
    if (!name) return;
    const projectId = await createProject({ name });
    if (taskId) await assignTaskToProject({ taskId, projectId });
  }

  const rowProps = {
    activeId: activeTaskId,
    editing,
    editText,
    setEditText,
    onSelect: (t: Task) => router.push(`/tasks/${t._id}`),
    onStartRename: (t: Task) => {
      setEditText(cleanTitle(t.title || t.area));
      setEditing({ kind: "task", id: t._id });
    },
    onCommitRename: commitRename,
    onCancelRename: () => setEditing(null),
    onDelete: onDeleteTask,
    projects,
    onAssign: (taskId: Id<"tasks">, projectId: Id<"projects"> | null) =>
      void assignTaskToProject({ taskId, projectId }),
    onMoveToNewProject: moveToNewProject,
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
          <span className="font-semibold tracking-tight">Convex Scientist</span>
        </div>
        <PasskeyButton />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r">
          <div className="space-y-2 p-3">
            <Button className="w-full" onClick={() => router.push("/")}>
              New task
            </Button>
            {creatingProject ? (
              <input
                autoFocus
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitNewProject();
                  if (e.key === "Escape") cancelNewProject();
                }}
                onBlur={() => void commitNewProject()}
                placeholder="New project name…"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              />
            ) : (
              <button
                type="button"
                onClick={startNewProject}
                className="w-full rounded-md border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                + New project
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {tasks.length === 0 && projects.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No tasks yet. Start one to investigate an area.
              </p>
            )}

            {ungrouped.map((t) => (
              <TaskRow key={t._id} task={t} {...rowProps} />
            ))}

            {projects.map((p) => {
              const open = !collapsed.has(p._id);
              const items = tasks.filter((t) => t.projectId === p._id);
              const isEditingP = editing?.kind === "project" && editing.id === p._id;
              return (
                <div key={p._id} className="mt-2">
                  <div className="group/row flex items-center gap-1 px-1">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((s) => {
                          const n = new Set(s);
                          if (n.has(p._id)) n.delete(p._id);
                          else n.add(p._id);
                          return n;
                        })
                      }
                      className="text-xs text-muted-foreground"
                      aria-label={open ? "Collapse" : "Expand"}
                    >
                      {open ? "▾" : "▸"}
                    </button>
                    {isEditingP ? (
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditing(null);
                        }}
                        onBlur={commitRename}
                        className="w-full rounded border bg-background px-1.5 py-1 text-xs font-medium"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => router.push(`/projects/${p._id}`)}
                          className={`flex-1 truncate text-left text-xs font-semibold uppercase tracking-wide hover:text-foreground ${
                            activeProjectId === p._id
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }`}
                          title={`Open ${p.name} Drive`}
                        >
                          {p.name}
                        </button>
                        <RowMenu
                          onRename={() => {
                            setEditText(p.name);
                            setEditing({ kind: "project", id: p._id });
                          }}
                          onDelete={() => void onDeleteProject(p)}
                        />
                      </>
                    )}
                  </div>
                  {open && (
                    <div className="ml-3 border-l pl-1">
                      {items.length === 0 && (
                        <p className="px-2 py-1 text-xs text-muted-foreground">No tasks</p>
                      )}
                      {items.map((t) => (
                        <TaskRow key={t._id} task={t} {...rowProps} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  activeId,
  editing,
  editText,
  setEditText,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  projects,
  onAssign,
  onMoveToNewProject,
}: {
  task: Task;
  activeId?: Id<"tasks">;
  editing: Editing;
  editText: string;
  setEditText: (v: string) => void;
  onSelect: (t: Task) => void;
  onStartRename: (t: Task) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDelete: (t: Task) => void;
  projects: Project[];
  onAssign: (taskId: Id<"tasks">, projectId: Id<"projects"> | null) => void;
  onMoveToNewProject: (taskId: Id<"tasks">) => void;
}) {
  const isActive = activeId === task._id;
  const isEditing = editing?.kind === "task" && editing.id === task._id;

  if (isEditing) {
    return (
      <input
        autoFocus
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommitRename();
          if (e.key === "Escape") onCancelRename();
        }}
        onBlur={onCommitRename}
        className="mb-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
    );
  }

  return (
    <div
      className={`group/row mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 ${
        isActive ? "bg-accent" : "hover:bg-muted"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          isActive ? "bg-primary" : "bg-muted-foreground/40"
        }`}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => onSelect(task)}
        className={`min-w-0 flex-1 truncate text-left text-sm ${isActive ? "font-medium" : ""}`}
        title={task.title || task.area}
      >
        {cleanTitle(task.title || task.area) || "Untitled task"}
      </button>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {relTime(task._creationTime)}
      </span>
      <div className="shrink-0 opacity-0 group-hover/row:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded px-1 text-muted-foreground hover:text-foreground"
              aria-label="Task actions"
            >
              ⋯
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onStartRename(task)}>Rename</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to project…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.length === 0 && (
                  <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
                )}
                {projects.map((p) => (
                  <DropdownMenuItem key={p._id} onClick={() => onAssign(task._id, p._id)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onMoveToNewProject(task._id)}>
                  New project…
                </DropdownMenuItem>
                {task.projectId && (
                  <DropdownMenuItem onClick={() => onAssign(task._id, null)}>
                    Remove from project
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(task)}
              className="text-red-600 focus:text-red-600"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function RowMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded px-1 text-muted-foreground opacity-0 hover:text-foreground group-hover/row:opacity-100"
          aria-label="Project actions"
        >
          ⋯
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-600">
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
