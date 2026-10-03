import type { Status } from "../components/StatusBadge.tsx";
import type { TaskView } from "./api.ts";
import { relativeTime } from "./utils.ts";

/**
 * Eight conditions, one mapping.
 *
 * Six of them are `state` alone; two are `state: "running"` split by `waiting.reason`, because
 * `waiting` is deliberately not a seventh state on the wire — a waiting task is running and
 * holds its concurrency slot. The split lives here so the table, the detail pane and the status
 * bar cannot drift apart about what a task is called.
 *
 * Hue decisions behind the table (ui-ux-pro-max ux-guidelines No. 37 — never colour alone):
 *
 *   - **Amber means "a human is needed here", and only that.** `waiting` (both reasons) and
 *     `blocked` share it. Three conditions, one meaning, one hue.
 *   - **Queued is blue, not amber.** A queued task needs nothing from anybody; at concurrency 2
 *     a backlog is the normal majority, and amber rows would drown the one task parked on a
 *     permission prompt.
 *   - **Succeeded is slate, not green.** Green is the accent and it means *live*. A finished
 *     queue glowing green would stop "what is running right now" being findable at a glance.
 */
export interface TaskBadge {
  status: Status;
  label: string;
  /** Hover detail. Undefined rather than empty — the CLI can report a wait with no reason. */
  title?: string;
}

export function taskBadge(task: TaskView): TaskBadge {
  switch (task.state) {
    case "queued":
      return { status: "queued", label: "Queued" };
    case "running":
      if (!task.waiting) return { status: "running", label: "Running" };
      return task.waiting.reason === "permission"
        ? {
            status: "waiting",
            label: "Needs permission",
            title: "The agent asked to use a tool and is waiting for an answer.",
          }
        : // The CLI's own word for the wait, verbatim. We do not synthesise one, so an
          // unnamed wait gets the soft label and no detail.
          { status: "waiting", label: "Waiting — may need input", title: task.waiting.detail || undefined };
    case "succeeded":
      return { status: "finished", label: "Succeeded" };
    case "failed":
      return { status: "failed", label: "Failed", title: task.error ?? undefined };
    case "blocked":
      return { status: "blocked", label: "Blocked" };
    case "cancelled":
      return { status: "cancelled", label: "Cancelled" };
    default: {
      // A state the server grew and this client has not learnt yet. Never a silent blank.
      const unreachable: never = task.state;
      return { status: "unknown", label: String(unreachable) };
    }
  }
}

/**
 * The badge's second channel: the one extra fact that state implies.
 *
 * Status is never only a hue and never only a word either — a queued row that cannot say how
 * far down the queue it is has told the operator nothing they came to find out.
 */
export function taskDetail(task: TaskView, queuedTotal: number, now = Date.now()): string | null {
  switch (task.state) {
    case "queued":
      return task.queuePosition === null ? null : `${ordinal(task.queuePosition)} of ${queuedTotal}`;
    case "running":
      if (task.waiting) return `waiting ${relativeTime(task.waiting.since, now)}`;
      return task.startedAt === null ? null : `started ${relativeTime(task.startedAt, now)}`;
    case "failed":
      return firstLine(task.error);
    case "blocked":
      return firstLine(task.result);
    case "succeeded":
    case "cancelled":
      return duration(task.startedAt, task.finishedAt);
    default:
      return null;
  }
}

/** `1` → `"1st"`. Recognition over recall: "3rd of 7" reads, "position 3" has to be decoded. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** How long it ran, in the coarsest unit that is still true. `null` when it never started. */
export function duration(startedAt: number | null, finishedAt: number | null): string | null {
  if (startedAt === null || finishedAt === null) return null;
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `ran ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `ran ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `ran ${hours}h ${minutes % 60}m`;
}

function firstLine(text: string | null): string | null {
  const line = text?.split("\n").find((l) => l.trim());
  return line?.trim() ?? null;
}

/** Which group of the table a task belongs to. The server already returns them in this order. */
export type TaskGroup = "running" | "queued" | "history";

export function taskGroup(task: TaskView): TaskGroup {
  if (task.state === "running") return "running";
  if (task.state === "queued") return "queued";
  return "history";
}

/**
 * Priority as three named levels rather than a number field.
 *
 * The server keeps `priority` a plain int and knows nothing about these; the mapping is purely
 * a recognition-over-recall choice on this side, with headroom left on both ends in case a
 * numeric control ever appears.
 */
export const PRIORITY_LEVELS = [
  { value: 1, label: "High" },
  { value: 0, label: "Normal" },
  { value: -1, label: "Low" },
] as const;

export function priorityLabel(priority: number): string {
  if (priority > 0) return "High";
  if (priority < 0) return "Low";
  return "Normal";
}
