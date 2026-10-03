/**
 * The HTTP side of the client. Everything here is a plain fetch against the loopback server;
 * React Query owns caching and the SSE stream owns invalidation (see hooks/useEventStream.ts).
 * There is no polling in this file and none anywhere else.
 */

/** A non-2xx response, carrying the server's `{ error }` message when it sent one. */
export class ApiError extends Error {
  /** `0` means the request never reached the server. */
  readonly status: number;

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
  } catch (cause) {
    // fetch only rejects when the server is unreachable — worth saying so plainly.
    throw new ApiError("Could not reach the claude-agent-ui server. Is it still running?", 0, { cause });
  }
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new ApiError(message ?? `${res.status} ${res.statusText}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/* ---------------------------------------------------------------------------------------
 * Resource types, mirroring the server. Kept narrow on purpose: the screens that consume
 * these land in M3–M5, and each milestone widens the type it needs.
 * ------------------------------------------------------------------------------------ */

/** See PublicAgent in ../../src/domain/agents.ts. */
export interface Agent {
  id: string;
  name: string;
  runName: string;
  description: string;
  model: string | null;
  source: string;
  editable: boolean;
  /** False when the file's frontmatter does not parse; `error` says why. */
  valid: boolean;
  error: string | null;
}

/**
 * See RunStatus in ../../src/domain/runs.ts — this must list every member the server can send.
 * `waiting` is parked on a prompt a human has to answer: not finished, and not progress either.
 */
export type RunStatus = "running" | "waiting" | "finished" | "failed" | "stopped" | "missing" | "unknown";

/** See SessionWait in ../../src/claude/claudeCli.ts. */
export interface RunWait {
  /** `permission` only when the CLI named a permission prompt; everything else is `other`. */
  reason: "permission" | "other";
  /** The CLI's own `waitingFor`, verbatim. Empty when it reported a wait with no reason, so render it conditionally. */
  detail: string;
}

export interface RunView {
  runId: string;
  agent: string;
  cwd: string;
  status: RunStatus;
  /** Non-null only while `status === "waiting"`. */
  waiting: RunWait | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  finalText: string | null;
  attachCommand: string;
}

export interface RunList {
  runs: RunView[];
  /** Set when the run list could only be partially resolved; shown to the user, never swallowed. */
  warning?: string | null;
}

/** Query keys live in one place so an SSE handler and a screen cannot disagree about them. */
export const queryKeys = {
  config: ["config"] as const,
  agents: ["agents"] as const,
  agent: (id: string) => ["agents", id] as const,
  runs: ["runs"] as const,
  skills: ["skills"] as const,
  tasks: ["tasks"] as const,
  taskStats: ["tasks", "stats"] as const,
  schedules: ["schedules"] as const,
};

export const listRuns = () => api.get<RunList>("/api/runs");
export const listAgents = () => api.get<Agent[]>("/api/agents");
