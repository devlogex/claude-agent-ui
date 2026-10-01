import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type BackgroundSession, CliError, ClaudeCli } from "./claudeCli.ts";
import { expandHome } from "./config.ts";
import { findTranscript, readFinalMessage } from "./transcript.ts";

/** "unknown" = `claude agents --json` could not be read this time. */
export type RunStatus = "running" | "finished" | "stopped" | "missing" | "unknown";

export interface RunRecord {
  runId: string;
  sessionId: string | null;
  agent: string;
  cwd: string;
  startedAt: number;
}

export interface RunsResponse {
  runs: RunView[];
  warning: string | null;
}

export interface RunView extends RunRecord {
  status: RunStatus;
  endedAt: number | null;
  finalText: string | null;
  attachCommand: string;
}

export class RunError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function mapStatus(session: BackgroundSession | undefined): RunStatus {
  if (!session) return "missing";
  if (session.state === "stopped" || (session.pid === undefined && session.status === undefined)) return "stopped";
  if (session.status === "idle") return "finished";
  return "running";
}

const TRUST_HINT = /not trusted/i;
export const MAX_PROMPT_LENGTH = 100_000;
// Plugin agents are "<plugin>:<agent>"; never allow a leading "-" (would be read as a CLI option).
const RUN_NAME = /^([a-z0-9][\w.-]*:)?[a-z0-9][\w.-]*$/i;

export class RunStore {
  private readonly file: string;
  private writeChain: Promise<unknown> = Promise.resolve();
  private finalCache = new Map<string, { mtimeMs: number; text: string | null; timestamp: string | null }>();

  constructor(
    private readonly home: string,
    private readonly cli: ClaudeCli,
    private readonly starterPrompt: string,
    dataDir = path.join(home, ".claude-agent-ui"),
  ) {
    this.file = path.join(dataDir, "runs.json");
  }

  private async load(): Promise<RunRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      // Only a missing file means "no runs"; other errors must not let mutate() overwrite history.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  }

  /** Serializes read-modify-write cycles so concurrent requests can't drop records. */
  private mutate<T>(fn: (runs: RunRecord[]) => T | Promise<T>): Promise<T> {
    const next = this.writeChain.then(async () => {
      const runs = await this.load();
      const result = await fn(runs);
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(runs, null, 2));
      await rename(tmp, this.file);
      return result;
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  /** A blank or missing prompt falls back to the configured starter prompt. */
  async start(agent: string, cwdInput: string, promptInput?: unknown, unattendedInput?: unknown): Promise<RunRecord> {
    if (!RUN_NAME.test(agent)) throw new RunError(`invalid agent name: ${agent}`);
    const unattended = unattendedInput ?? false;
    if (typeof unattended !== "boolean") throw new RunError("unattended must be a boolean");
    const custom = promptInput ?? "";
    if (typeof custom !== "string") throw new RunError("prompt must be a string");
    if (custom.length > MAX_PROMPT_LENGTH) throw new RunError(`prompt is too long (max ${MAX_PROMPT_LENGTH} characters)`);
    // execFile rejects NUL in argv; report it as bad input rather than a CLI failure.
    if (custom.includes("\0")) throw new RunError("prompt must not contain NUL characters");
    const prompt = custom.trim() ? custom : this.starterPrompt;
    const cwd = expandHome(cwdInput.trim(), this.home);
    if (!cwd || !path.isAbsolute(cwd)) throw new RunError("working directory must be an absolute path");
    try {
      if (!(await stat(cwd)).isDirectory()) throw new Error();
    } catch {
      throw new RunError(`working directory does not exist: ${cwd}`);
    }

    let runId: string;
    try {
      runId = await this.cli.startBackground({ agent, cwd, prompt, unattended });
    } catch (err) {
      const message = err instanceof CliError ? err.message : (err as Error).message;
      const hint = TRUST_HINT.test(message)
        ? `\n\nOpen iTerm2, run: cd ${cwd} && claude — accept the trust prompt once, then retry.`
        : "";
      throw new RunError(`claude --bg failed: ${message}${hint}`, 502);
    }

    let sessionId: string | null = null;
    try {
      const sessions = await this.cli.listSessions();
      sessionId = sessions.find((s) => s.id === runId)?.sessionId ?? null;
    } catch {
      // resolved lazily in list()
    }
    const record: RunRecord = { runId, sessionId, agent, cwd, startedAt: Date.now() };
    await this.mutate((runs) => {
      runs.unshift(record);
    });
    return record;
  }

  private async finalMessage(sessionId: string) {
    const file = await findTranscript(this.home, sessionId);
    if (!file) return null;
    const { mtimeMs } = await stat(file);
    const cached = this.finalCache.get(sessionId);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    const msg = await readFinalMessage(file);
    const entry = { mtimeMs, text: msg?.text ?? null, timestamp: msg?.timestamp ?? null };
    this.finalCache.set(sessionId, entry);
    return entry;
  }

  async list(): Promise<RunsResponse> {
    const runs = await this.load();
    let sessions: BackgroundSession[] | null = null;
    let warning: string | null = null;
    try {
      sessions = await this.cli.listSessions();
    } catch (err) {
      warning = `could not read claude agents --json: ${(err as Error).message}`;
    }
    const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
    const unresolved = runs.filter((r) => !r.sessionId && byId.get(r.runId)?.sessionId);
    if (unresolved.length) {
      await this.mutate((all) => {
        for (const r of all) if (!r.sessionId) r.sessionId = byId.get(r.runId)?.sessionId ?? null;
      });
    }

    const views = await Promise.all(
      runs.map(async (run): Promise<RunView> => {
        const session = byId.get(run.runId);
        const sessionId = run.sessionId ?? session?.sessionId ?? null;
        const status: RunStatus = sessions ? mapStatus(session) : "unknown";
        let finalText: string | null = null;
        let endedAt: number | null = null;
        if (status !== "running" && sessionId) {
          const msg = await this.finalMessage(sessionId).catch(() => null);
          finalText = msg?.text ?? null;
          endedAt = msg?.timestamp ? Date.parse(msg.timestamp) : null;
        }
        return { ...run, sessionId, status, endedAt, finalText, attachCommand: `claude attach ${run.runId}` };
      }),
    );
    return { runs: views, warning };
  }

  private async requireRun(runId: string): Promise<RunRecord> {
    const run = (await this.load()).find((r) => r.runId === runId);
    if (!run) throw new RunError("run not found", 404);
    return run;
  }

  async stop(runId: string): Promise<void> {
    await this.requireRun(runId);
    try {
      await this.cli.stop(runId);
    } catch (err) {
      throw new RunError(`claude stop failed: ${(err as Error).message}`, 502);
    }
  }

  async remove(runId: string): Promise<void> {
    await this.requireRun(runId);
    try {
      await this.cli.remove(runId);
    } catch (err) {
      // A session that is already gone can still be forgotten locally.
      const sessions = await this.cli.listSessions().catch(() => null);
      const gone = sessions !== null && !sessions.some((s) => s.id === runId);
      if (!gone) throw new RunError(`claude rm failed: ${(err as Error).message}`, 502);
    }
    await this.mutate((runs) => {
      const i = runs.findIndex((r) => r.runId === runId);
      if (i >= 0) runs.splice(i, 1);
    });
  }

  async stopFinished(): Promise<string[]> {
    const finished = (await this.list()).runs.filter((r) => r.status === "finished");
    const stopped: string[] = [];
    for (const run of finished) {
      try {
        await this.cli.stop(run.runId);
        stopped.push(run.runId);
      } catch {
        // keep going; the panel will still show it as finished
      }
    }
    return stopped;
  }
}
