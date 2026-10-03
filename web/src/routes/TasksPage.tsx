import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, ListChecks, Plus, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { NewTaskDialog } from "../components/NewTaskDialog.tsx";
import { Page } from "../components/Page.tsx";
import { EmptyState, ErrorState, LoadingState, errorMessage } from "../components/States.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Select } from "../components/ui/field.tsx";
import {
  ApiError,
  cancelTask,
  listTasks,
  queryKeys,
  retryTask,
  updateTask,
  type TaskView,
} from "../lib/api.ts";
import { PRIORITY_LEVELS, taskBadge, taskDetail, taskGroup } from "../lib/taskStatus.ts";
import { cn, plural, relativeTime } from "../lib/utils.ts";

/**
 * The Tasks screen: every run the queue knows about, grouped by what it is doing.
 *
 * Not built on DataTable. That component is a flat, client-sorted list and this is neither —
 * the server already returns display order (running, then queue order, then most recently
 * finished), rows expand, and the groups carry their own headers. Bending DataTable to cover
 * grouping and expansion would make it worse for the screen it was written for, so this keeps
 * DataTable's density tokens and nothing else.
 *
 * Every number on screen arrives over SSE (`task:created` / `task:updated` / `task:removed`
 * invalidate the `["tasks"]` prefix). Nothing here polls.
 */
export function TasksPage() {
  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: listTasks });
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [announcement, setAnnouncement] = useState("");

  const all = useMemo(() => tasks.data?.tasks ?? [], [tasks.data]);
  const groups = useMemo(
    () => ({
      running: all.filter((t) => taskGroup(t) === "running"),
      queued: all.filter((t) => taskGroup(t) === "queued"),
      history: all.filter((t) => taskGroup(t) === "history"),
    }),
    [all],
  );

  const transition = useStateChanges(all);
  // One message at a time, so the live region reads a real transition rather than a queue of
  // stale ones. Set by the differ, or overwritten by an action the user just took.
  useEffect(() => {
    if (transition) setAnnouncement(transition);
  }, [transition]);

  // The highlight is a ring, not a flash: it survives prefers-reduced-motion unchanged, and it
  // clears itself so a row is not left marked forever.
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 6_000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  function handleCreated(task: TaskView) {
    setHighlightId(task.id);
    setAnnouncement(`Queued "${task.title}".`);
  }

  return (
    <Page
      title="Tasks"
      description="The work queue: everything this server has been asked to run"
      actions={
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          New task
        </Button>
      }
    >
      {/*
        Polite and never focus-moving — a task flipping state under the cursor must not steal
        focus from the Cancel button someone is tabbed into (ux-guidelines No. 118).
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {tasks.data?.warning && (
        // A bar, not a toast. A toast disappears; the staleness does not.
        <p
          role="status"
          className={cn(
            "flex items-start gap-2 border-b border-border px-6 py-2 text-xs leading-normal",
            "bg-[var(--notice-bg)] text-[var(--notice-fg)]",
          )}
        >
          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            Task states may be out of date — the Claude CLI did not respond. {tasks.data.warning}
          </span>
        </p>
      )}

      {tasks.error ? (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : tasks.isLoading ? (
        <LoadingState label="Loading tasks" rows={8} className="p-6" />
      ) : all.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No tasks yet"
          description="A task is one agent run, queued and watched. Create one and it starts as soon as a slot is free."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              New task
            </Button>
          }
        />
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Tasks, grouped by state</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Title</th>
              <th scope="col">Agent</th>
              <th scope="col">Working directory</th>
              <th scope="col">Time</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>

          <TaskGroupBody
            label="Running"
            tasks={groups.running}
            // The concurrency limit is learnable from the screen rather than from the README.
            emptyNote="Nothing running right now."
            expandedId={expandedId}
            onToggle={setExpandedId}
            highlightId={highlightId}
            queuedTotal={groups.queued.length}
            onAction={setAnnouncement}
            onHighlight={setHighlightId}
          />
          <TaskGroupBody
            label="Queued"
            tasks={groups.queued}
            emptyNote="Nothing waiting."
            expandedId={expandedId}
            onToggle={setExpandedId}
            highlightId={highlightId}
            queuedTotal={groups.queued.length}
            onAction={setAnnouncement}
            onHighlight={setHighlightId}
          />
          <TaskGroupBody
            label="History"
            tasks={groups.history}
            emptyNote="Nothing has finished yet."
            collapsible
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            expandedId={expandedId}
            onToggle={setExpandedId}
            highlightId={highlightId}
            queuedTotal={groups.queued.length}
            onAction={setAnnouncement}
            onHighlight={setHighlightId}
          />
        </table>
      )}

      <NewTaskDialog open={creating} onOpenChange={setCreating} onCreated={handleCreated} />
    </Page>
  );
}

/* ---------------------------------------------------------------------------------------- */

interface TaskGroupBodyProps {
  label: string;
  tasks: TaskView[];
  /** Shown instead of collapsing the group, so an empty Running section still teaches. */
  emptyNote: string;
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  expandedId: string | null;
  onToggle: (id: string | null) => void;
  highlightId: string | null;
  queuedTotal: number;
  onAction: (message: string) => void;
  onHighlight: (id: string) => void;
}

function TaskGroupBody({
  label,
  tasks,
  emptyNote,
  collapsible,
  open = true,
  onOpenChange,
  expandedId,
  onToggle,
  highlightId,
  queuedTotal,
  onAction,
  onHighlight,
}: TaskGroupBodyProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <tbody>
      <tr>
        <th
          scope="colgroup"
          colSpan={6}
          className={cn(
            "sticky top-0 z-10 border-y border-border bg-[var(--table-header-bg)]",
            "px-6 py-[var(--table-cell-pad-y)] text-left",
            "text-2xs font-semibold uppercase tracking-[var(--tracking-wide)] text-[var(--table-header-fg)]",
          )}
        >
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onOpenChange?.(!open)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm hover:text-fg"
            >
              <Chevron aria-hidden="true" className="size-3" />
              {label}
              <span className="font-mono tabular-nums">{tasks.length}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {label}
              <span className="font-mono tabular-nums">{tasks.length}</span>
            </span>
          )}
        </th>
      </tr>

      {!open ? null : tasks.length === 0 ? (
        <tr>
          <td colSpan={6} className="border-b border-border px-6 py-3 text-xs text-fg-subtle">
            {emptyNote}
          </td>
        </tr>
      ) : (
        tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            expanded={expandedId === task.id}
            onToggle={() => onToggle(expandedId === task.id ? null : task.id)}
            highlighted={highlightId === task.id}
            queuedTotal={queuedTotal}
            onAction={onAction}
            onHighlight={onHighlight}
          />
        ))
      )}
    </tbody>
  );
}

/* ---------------------------------------------------------------------------------------- */

interface TaskRowProps {
  task: TaskView;
  expanded: boolean;
  onToggle: () => void;
  highlighted: boolean;
  queuedTotal: number;
  onAction: (message: string) => void;
  onHighlight: (id: string) => void;
}

function TaskRow({ task, expanded, onToggle, highlighted, queuedTotal, onAction, onHighlight }: TaskRowProps) {
  const badge = taskBadge(task);
  const detail = taskDetail(task, queuedTotal);
  const row = useRef<HTMLTableRowElement>(null);
  const [message, setMessage] = useState<{ text: string; tone: "quiet" | "danger" } | null>(null);

  useEffect(() => {
    if (highlighted) row.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });

  /** The races are expected on a live table, so they are quiet and specific, never a red wall. */
  function handleError(error: unknown) {
    invalidate();
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
      setMessage({ text: error.message, tone: "quiet" });
      return;
    }
    setMessage({ text: errorMessage(error), tone: "danger" });
  }

  const cancel = useMutation({
    mutationFn: () => cancelTask(task.id),
    onSuccess: () => {
      setMessage(null);
      onAction(`Cancelled "${task.title}".`);
      invalidate();
    },
    onError: handleError,
  });

  const retry = useMutation({
    mutationFn: () => retryTask(task.id),
    onSuccess: (created) => {
      setMessage(null);
      // Retry clones: the clicked row keeps its history and a *new* queued row appears. Saying
      // so, and pointing at it, is the difference between a successful action and a no-op.
      onHighlight(created.id);
      onAction(`Retried "${task.title}" as a new queued task.`);
      invalidate();
    },
    onError: handleError,
  });

  const reprioritise = useMutation({
    mutationFn: (priority: number) => updateTask(task.id, { priority }),
    onSuccess: () => {
      setMessage(null);
      invalidate();
    },
    onError: handleError,
  });

  const busy = cancel.isPending || retry.isPending || reprioritise.isPending;
  const terminal = task.state !== "queued" && task.state !== "running";
  const timestamp = task.finishedAt ?? task.startedAt ?? task.createdAt;

  return (
    <>
      <tr
        ref={row}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          if (e.target !== e.currentTarget) return; // A button inside the row owns its own keys.
          e.preventDefault();
          onToggle();
        }}
        className={cn(
          "h-[var(--task-row-height)] cursor-pointer border-b border-[var(--table-border)]",
          "transition-colors duration-[var(--duration-fast)] hover:bg-[var(--table-row-bg-hover)]",
          expanded && "bg-[var(--table-row-bg-selected)]",
          highlighted && "outline outline-2 -outline-offset-2 outline-[var(--color-accent)]",
        )}
      >
        <td className="w-[var(--status-col-width)] py-[var(--table-cell-pad-y)] pl-6 pr-[var(--table-cell-pad-x)] align-middle">
          <StatusBadge status={badge.status} label={badge.label} title={badge.title} />
          {detail && (
            <span className="mt-0.5 block truncate text-2xs text-fg-muted" title={detail}>
              {detail}
            </span>
          )}
        </td>

        <td className="max-w-0 px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] align-middle">
          <span className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
            )}
            <span className="truncate font-medium text-fg">{task.title}</span>
          </span>
        </td>

        <td className="w-40 px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] align-middle">
          <span className="block truncate text-xs text-fg-muted">{task.agent}</span>
        </td>

        <td className="max-w-0 px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] align-middle">
          {/* Truncates from the left: the leaf directory is the part that identifies it. */}
          <span dir="rtl" className="block truncate text-left font-mono text-2xs text-fg-muted" title={task.cwd}>
            {task.cwd}
          </span>
        </td>

        <td className="w-24 whitespace-nowrap px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] text-right align-middle">
          <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()} className="text-xs text-fg-muted">
            {relativeTime(timestamp)}
          </time>
        </td>

        <td
          className="w-56 py-[var(--table-cell-pad-y)] pl-[var(--table-cell-pad-x)] pr-6 text-right align-middle"
          // Row actions, in the row. Cancel is never buried in a detail page.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <span className="inline-flex items-center justify-end gap-1.5">
            {task.state === "queued" && (
              <label className="inline-flex items-center gap-1">
                <span className="sr-only">Priority for {task.title}</span>
                <Select
                  value={String(task.priority > 0 ? 1 : task.priority < 0 ? -1 : 0)}
                  disabled={busy}
                  onChange={(e) => reprioritise.mutate(Number(e.target.value))}
                  className="h-[var(--button-height-sm)] w-24 text-xs"
                >
                  {PRIORITY_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {!terminal && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm" disabled={busy}>
                    <X aria-hidden="true" />
                    Cancel
                  </Button>
                }
                title={task.state === "queued" ? "Drop this task from the queue?" : "Stop this task?"}
                // Two bodies, because the consequences genuinely differ.
                description={
                  task.state === "queued"
                    ? `"${task.title}" has not started, so nothing is lost. It stays in the list as cancelled.`
                    : `"${task.title}" is part-way through. Work the agent has already done is kept; work it has not done will not happen.`
                }
                confirmLabel="Cancel task"
                cancelLabel="Keep it"
                onConfirm={() => cancel.mutate()}
              />
            )}

            {terminal && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => retry.mutate()}>
                <RotateCw aria-hidden="true" />
                Retry
              </Button>
            )}
          </span>
        </td>
      </tr>

      {(expanded || message) && (
        <tr className="border-b border-[var(--table-border)] bg-[var(--color-surface-sunken)]">
          <td colSpan={6} className="px-6 py-3">
            {message && (
              <p
                role="status"
                className={cn(
                  "mb-3 text-xs",
                  message.tone === "danger" ? "text-danger-fg" : "text-fg-muted",
                )}
              >
                {message.text}
              </p>
            )}
            {expanded && <TaskExpansion task={task} />}
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------------------- */

function TaskExpansion({ task }: { task: TaskView }) {
  const badge = taskBadge(task);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm font-medium text-fg">{task.title}</span>
        <Link
          to={`/tasks/${task.id}`}
          className="text-xs text-accent-fg underline-offset-2 hover:underline"
        >
          Open detail
        </Link>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <Meta label="Working directory">
          <span className="font-mono text-2xs">{task.cwd}</span>
        </Meta>
        <Meta label="Prompt">
          <span className="whitespace-pre-wrap text-fg-muted">{task.prompt}</span>
        </Meta>
      </dl>

      {task.waiting && (
        <section className="rounded-[var(--radius-md)] bg-[var(--notice-bg)] px-3 py-2">
          <p className="text-xs font-medium text-[var(--notice-fg)]">
            {badge.label}
            {task.waiting.detail ? ` — ${task.waiting.detail}` : ""}
          </p>
          {task.attachCommand && (
            <p className="mt-1 text-xs text-fg-muted">
              Answer it in a terminal: <code className="font-mono text-2xs text-fg">{task.attachCommand}</code>
            </p>
          )}
        </section>
      )}

      {task.error && (
        // The cause first. A red badge with no reason sends the user to a terminal.
        <section>
          <h3 className="text-xs font-medium text-danger-fg">Why it failed</h3>
          <p className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">{task.error}</p>
        </section>
      )}

      {task.result && (
        <section>
          <h3 className="text-xs font-medium text-fg-muted">
            {task.state === "blocked" ? "What it is blocked on" : "Result"}
          </h3>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-relaxed text-fg">
            {task.result}
          </pre>
        </section>
      )}

      {task.state === "queued" && (
        <p className="text-xs text-fg-subtle">
          Not started yet
          {task.queuePosition === null ? "" : `, ${plural(task.queuePosition - 1, "task")} ahead of it`}.
        </p>
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-fg-muted">{children}</dd>
    </>
  );
}

/* ---------------------------------------------------------------------------------------- */

/**
 * The one real state change since the last render, as a sentence.
 *
 * Keyed on the badge label rather than `state`, so entering `waiting` — which keeps
 * `state: "running"` — announces too. The server already dedupes its events per task, so a
 * ten-minute permission wait produces one announcement, not one per poll.
 */
function useStateChanges(tasks: TaskView[]): string {
  const previous = useRef<Map<string, string> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const next = new Map(tasks.map((task) => [task.id, taskBadge(task).label]));
    const before = previous.current;
    previous.current = next;
    if (!before) return; // First load is not a transition.

    const changed = tasks.filter((task) => {
      const was = before.get(task.id);
      return was !== undefined && was !== taskBadge(task).label;
    });
    if (changed.length === 1) {
      setMessage(`${changed[0]!.title}: ${taskBadge(changed[0]!).label}.`);
    } else if (changed.length > 1) {
      setMessage(`${plural(changed.length, "task")} changed state.`);
    }
  }, [tasks]);

  return message;
}
