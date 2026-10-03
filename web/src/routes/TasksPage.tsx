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
  getTaskStats,
  listTasks,
  queryKeys,
  retryTask,
  updateTask,
  type TaskView,
} from "../lib/api.ts";
import { PRIORITY_LEVELS, pathTail, taskBadge, taskGroup, taskReason, taskTiming } from "../lib/taskStatus.ts";
import { cn, plural, relativeTime } from "../lib/utils.ts";

/**
 * Columns that are supporting detail rather than the thing being scanned. Below `md` they
 * collapse to zero width — a 390px viewport has room for the state, the name and the action,
 * and nothing is lost because all three are in the row expansion.
 *
 * Collapsed rather than `display: none`: the group headers and the expansion row span all six
 * columns, and a `colSpan={6}` conjures a hidden column straight back into the table model with
 * no declared width, which then eats the title's. Zero width leaves the model intact.
 */
const SECONDARY = "max-md:w-0 max-md:overflow-hidden max-md:p-0";

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
  // Only for the concurrency limit: the counts on this screen come from the list itself.
  const stats = useQuery({ queryKey: queryKeys.taskStats, queryFn: getTaskStats });
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
        /* table-fixed, with the widths declared once on the header row: a long failure message
           in one cell must not be able to squeeze the title, which is the column people are
           actually scanning. The widths live on the <th> rather than a <colgroup> because the
           three secondary columns are display:none below `md` — a colgroup maps by column
           index, so it would mis-assign the widths the moment a column disappears. */
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Tasks, grouped by state</caption>
          {/*
            In flow, but zero height. `sr-only` would position this row absolutely, which takes
            it out of the table model — and then `table-fixed` has no header row to take its
            column widths from, which is exactly how the title column ends up at zero width.
            Collapsing it with h-0/p-0 keeps the widths and the header names both.
          */}
          <thead>
            <tr className="h-0">
              <th scope="col" className="h-0 w-[var(--status-col-width)] p-0 max-md:w-32">
                <span className="sr-only">Status</span>
              </th>
              <th scope="col" className="h-0 p-0">
                <span className="sr-only">Title</span>
              </th>
              <th scope="col" className={cn("h-0 w-40 p-0", SECONDARY)}>
                <span className="sr-only">Agent</span>
              </th>
              <th scope="col" className={cn("h-0 w-48 p-0", SECONDARY)}>
                <span className="sr-only">Working directory</span>
              </th>
              <th scope="col" className={cn("h-0 w-24 p-0", SECONDARY)}>
                <span className="sr-only">Time</span>
              </th>
              <th scope="col" className="h-0 w-52 p-0 max-md:w-14">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <TaskGroupBody
            label="Running"
            tasks={groups.running}
            // The concurrency limit is learnable from the screen rather than from the README,
            // so a backlog that is not moving explains itself.
            suffix={stats.data ? `of ${stats.data.maxConcurrent}` : undefined}
            emptyNote={
              stats.data
                ? `Nothing running. Up to ${plural(stats.data.maxConcurrent, "task")} run at once.`
                : "Nothing running."
            }
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
  /** Appended after the count, e.g. the concurrency limit on the Running group. */
  suffix?: string;
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
  suffix,
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
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm uppercase tracking-[var(--tracking-wide)] hover:text-fg"
            >
              <Chevron aria-hidden="true" className="size-3" />
              {label}
              <span className="font-mono tabular-nums">{tasks.length}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {label}
              <span className="font-mono tabular-nums">{tasks.length}</span>
              {suffix && <span className="font-normal normal-case tracking-normal">{suffix}</span>}
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
  const timing = taskTiming(task, queuedTotal);
  const reason = taskReason(task);
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
      {/*
        The row stays a row. Making the whole <tr> a role="button" would throw away the column
        associations a screen reader needs, and the Cancel button inside it would be an
        interactive descendant of a button, which is invalid. The disclosure is a real button
        on the title instead: native keys, native focus, one honest aria-expanded.
      */}
      <tr
        ref={row}
        className={cn(
          "h-[var(--task-row-height)] border-b border-[var(--table-border)]",
          "transition-colors duration-[var(--duration-fast)] hover:bg-[var(--table-row-bg-hover)]",
          expanded && "bg-[var(--table-row-bg-selected)]",
          highlighted && "outline outline-2 -outline-offset-2 outline-[var(--color-accent)]",
        )}
      >
        <td className="py-[var(--table-cell-pad-y)] pl-6 pr-[var(--table-cell-pad-x)] align-middle">
          <StatusBadge status={badge.status} label={badge.label} title={badge.title} />
          {timing && <span className="mt-0.5 block truncate text-2xs text-fg-muted">{timing}</span>}
        </td>

        <td className="px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] align-middle">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm text-left"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium text-fg">{task.title}</span>
          </button>
          {/*
            Why it failed, or what it is blocked on — where there is room to read it, and
            deliberately *outside* the button: inside, it concatenates onto the accessible name
            and a screen reader announces "Upgrade the test runner to v4the background session…".
          */}
          {reason && <span className="mt-0.5 block truncate pl-[1.125rem] text-2xs text-fg-muted">{reason}</span>}
        </td>

        <td className={cn("px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] align-middle", SECONDARY)}>
          <span className="block truncate text-xs text-fg-muted max-md:hidden">{task.agent}</span>
        </td>

        <td className={cn("px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] align-middle", SECONDARY)}>
          {/* The leaf directory is the part that identifies it; the whole path is the tooltip. */}
          <span className="block truncate font-mono text-2xs text-fg-muted max-md:hidden" title={task.cwd}>
            {pathTail(task.cwd)}
          </span>
        </td>

        <td
          className={cn(
            "whitespace-nowrap px-[var(--table-cell-pad-x)] py-[var(--table-cell-pad-y)] text-right align-middle",
            SECONDARY,
          )}
        >
          <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()} className="text-xs text-fg-muted">
            {relativeTime(timestamp)}
          </time>
        </td>

        {/* Row actions, in the row. Cancel is never buried in a detail page. */}
        <td className="py-[var(--table-cell-pad-y)] pl-[var(--table-cell-pad-x)] pr-6 text-right align-middle">
          <span className="inline-flex items-center justify-end gap-1.5">
            {/* Reordering is a desktop affordance: at 390px the select would cost the title
                the width it needs, and the queue position is still readable in the row. */}
            {task.state === "queued" && (
              <label className="inline-flex items-center gap-1 max-md:hidden">
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
                  <Button variant="ghost" size="sm" disabled={busy} aria-label={`Cancel ${task.title}`}>
                    <X aria-hidden="true" />
                    <span className="max-md:sr-only">Cancel</span>
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
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Retry ${task.title}`}
                onClick={() => retry.mutate()}
              >
                <RotateCw aria-hidden="true" />
                <span className="max-md:sr-only">Retry</span>
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
  const reason = taskReason(task);
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
            {reason ? ` — ${reason}` : ""}
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
