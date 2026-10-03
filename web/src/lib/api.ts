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
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/* ---------------------------------------------------------------------------------------
 * Resource types, mirroring the server. Kept narrow on purpose: the screens that consume
 * these land in M3–M5, and each milestone widens the type it needs.
 * ------------------------------------------------------------------------------------ */

/** Where a definition lives. See Scope in ../../src/domain/scopes.ts. */
export type Scope = "user" | "project" | "plugin";

/** One frontmatter problem, named by the field it belongs to. See FieldError in ../../src/domain/errors.ts. */
export interface FieldError {
  /** A frontmatter key (`name`, `description`), or `frontmatter`/`content` for whole-file problems. */
  field: string;
  message: string;
}

/** What the validate routes answer: `fields` is empty exactly when `valid` is true. */
export interface ValidationResult {
  valid: boolean;
  fields: FieldError[];
}

/** See PublicAgent in ../../src/domain/agents.ts. */
export interface Agent {
  id: string;
  name: string;
  runName: string;
  description: string;
  model: string | null;
  scope: Scope;
  /** The owning plugin's short name; null for user and project agents. */
  plugin: string | null;
  editable: boolean;
  /** Why the file cannot be edited, in a sentence to show the user; null when it can. */
  readOnlyReason: string | null;
  /** False when the file's frontmatter does not parse; `error` says why. */
  valid: boolean;
  error: string | null;
}

/** See AgentSkillAccess in ../../src/domain/skills.ts. */
export interface AgentSkillAccess {
  kind: "all" | "allowlist" | "none";
  /** A sentence explaining `kind`, written to be shown as-is. */
  reason: string;
  skills: Skill[];
  /** Allowlisted names matching no skill on disk — almost always a typo. */
  unknown: string[];
}

export interface AgentDetail extends Agent {
  /** The whole file, frontmatter included. */
  content: string;
  skillAccess: AgentSkillAccess;
}

/** See PublicSkill in ../../src/domain/skills.ts. */
export interface Skill {
  id: string;
  name: string;
  /** How the skill is referenced: the bare name, or `<plugin>:<skill>` for a plugin's. */
  ref: string;
  description: string;
  scope: Scope;
  plugin: string | null;
  editable: boolean;
  readOnlyReason: string | null;
  valid: boolean;
  error: string | null;
  /** The skill's directory name. Claude Code expects it to match `name`, so edits may not rename. */
  dirName: string;
}

export interface SkillDetail extends Skill {
  /** The whole SKILL.md, frontmatter included. */
  content: string;
  /** Just the markdown after the frontmatter. Empty when the frontmatter does not parse. */
  body: string;
}

/** The scopes a definition can be created in; `plugin` files belong to their plugin. */
export type WritableScope = Exclude<Scope, "plugin">;

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

/* --- Tasks. Mirrors src/domain/queue.ts; frozen as the M4 tasks-api-contract. ---------- */

export type TaskState = "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";

/** What a running task is parked on. Non-null only while `state === "running"`. */
export interface TaskWaiting {
  reason: "permission" | "other";
  /** The CLI's own `waitingFor`, verbatim. Empty when it named no reason — render conditionally. */
  detail: string;
  /** Epoch ms we first observed the wait, carried across polls while the same wait holds. */
  since: number;
}

export interface TaskView {
  id: string;
  title: string;
  /** The agent's runName, not its file id. */
  agent: string;
  cwd: string;
  prompt: string;
  permissionMode: PermissionMode;
  unattended: boolean;
  priority: number;
  state: TaskState;
  attempts: number;
  maxAttempts: number;
  runId: string | null;
  sessionId: string | null;
  scheduleId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Display-ready: the server has already stripped the `BLOCKED:` sentinel. Never strip again. */
  result: string | null;
  /** Why it failed. Set only when `state === "failed"`. */
  error: string | null;
  waiting: TaskWaiting | null;
  /** 1-based position in the queue; null unless `state === "queued"`. Server-derived. */
  queuePosition: number | null;
  /** `claude attach <runId>`; non-null whenever `runId` is. */
  attachCommand: string | null;
}

export interface TaskList {
  tasks: TaskView[];
  /** The watcher's last failed poll, so the table can say its states may be stale. */
  warning: string | null;
}

export interface TaskStats {
  queued: number;
  /** Includes waiting tasks — they hold their slot. Never add `running` and `waiting`. */
  running: number;
  waiting: number;
  maxConcurrent: number;
}

export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  /** Epoch ms, or null when the JSONL line carried no timestamp. */
  at: number | null;
}

export interface TranscriptPage {
  messages: TranscriptMessage[];
  /** True when older messages were dropped to keep the response bounded. */
  truncated: boolean;
}

/**
 * `bypassPermissions` passes `--dangerously-skip-permissions`. There is deliberately no `skip`
 * alias: two spellings for one meaning is how a typo falls through to the dangerous branch.
 */
export type PermissionMode = "ask" | "bypassPermissions";

export interface NewTask {
  /** The agent *file* id, which the server resolves to its runName. */
  agentId: string;
  cwd?: string;
  prompt?: string;
  title?: string;
  permissionMode?: PermissionMode;
  unattended?: boolean;
  priority?: number;
}

/** What `GET /api/config` answers. `permissionMode` is read for runs — never for a task form. */
export interface AppConfig {
  defaultCwd: string;
  starterPrompt: string;
  permissionMode: PermissionMode;
}

/** Query keys live in one place so an SSE handler and a screen cannot disagree about them. */
export const queryKeys = {
  config: ["config"] as const,
  agents: ["agents"] as const,
  agent: (id: string) => ["agents", id] as const,
  runs: ["runs"] as const,
  skills: ["skills"] as const,
  skill: (id: string) => ["skills", id] as const,
  tasks: ["tasks"] as const,
  taskStats: ["tasks", "stats"] as const,
  taskTranscript: (id: string) => ["tasks", id, "transcript"] as const,
  schedules: ["schedules"] as const,
};

export const listRuns = () => api.get<RunList>("/api/runs");

export const listAgents = () => api.get<Agent[]>("/api/agents");
export const getAgent = (id: string) => api.get<AgentDetail>(`/api/agents/${id}`);
export const createAgent = (content: string, scope: WritableScope = "user") =>
  api.post<{ id: string; scope: WritableScope }>("/api/agents", { content, scope });
export const updateAgent = (id: string, content: string) => api.put<{ id: string }>(`/api/agents/${id}`, { content });
export const deleteAgent = (id: string) => api.delete<{ id: string }>(`/api/agents/${id}`);

export const listSkills = () => api.get<Skill[]>("/api/skills");
export const getSkill = (id: string) => api.get<SkillDetail>(`/api/skills/${id}`);
export const createSkill = (content: string, scope: WritableScope = "user") =>
  api.post<{ id: string; scope: WritableScope }>("/api/skills", { content, scope });
export const updateSkill = (id: string, content: string) => api.put<{ id: string }>(`/api/skills/${id}`, { content });
export const deleteSkill = (id: string) => api.delete<{ id: string }>(`/api/skills/${id}`);

/**
 * Checks a draft without saving it, for inline errors as the user types.
 *
 * Always resolves for a reachable server: an invalid draft mid-edit is a normal state, not an
 * error, so there is nothing to catch except the server being gone.
 */
export const validateAgent = (content: string) => api.post<ValidationResult>("/api/agents/validate", { content });
export const validateSkill = (content: string) => api.post<ValidationResult>("/api/skills/validate", { content });

export const getConfig = () => api.get<AppConfig>("/api/config");

export const listTasks = () => api.get<TaskList>("/api/tasks");
export const getTaskStats = () => api.get<TaskStats>("/api/tasks/stats");
export const createTask = (task: NewTask) => api.post<TaskView>("/api/tasks", task);
export const updateTask = (id: string, patch: { title?: string; priority?: number }) =>
  api.patch<TaskView>(`/api/tasks/${id}`, patch);
export const cancelTask = (id: string) => api.post<TaskView>(`/api/tasks/${id}/cancel`);
/** 201 with a **new** id: retry clones, so the row the user clicked keeps its history. */
export const retryTask = (id: string) => api.post<TaskView>(`/api/tasks/${id}/retry`);
export const getTaskTranscript = (id: string) => api.get<TranscriptPage>(`/api/tasks/${id}/transcript`);
