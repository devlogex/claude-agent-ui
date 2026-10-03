import { readFileSync, rmSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

/** Name of the lockfile inside the state directory. */
export const LOCK_FILE = "server.lock";

export class LockError extends Error {}

export interface LockInfo {
  pid: number;
  /** ms since epoch, only used to make the message friendlier. */
  startedAt: number;
}

export interface Lock {
  readonly file: string;
  readonly info: LockInfo;
  /**
   * Removes the lockfile if it is still ours. Safe to call more than once.
   *
   * Synchronous on purpose: it has to run on the way out of the process — from a signal handler or
   * an `exit` listener — where there is no chance to await anything.
   */
  release(): void;
}

/**
 * True when a process with this pid exists. Signal 0 performs the permission and existence checks
 * without delivering anything; EPERM means it exists but belongs to someone else, which still
 * counts as running.
 */
export function isProcessAlive(pid: number, kill = process.kill.bind(process)): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseLock(raw: string): LockInfo | null {
  try {
    const data = JSON.parse(raw) as Partial<LockInfo>;
    if (!Number.isInteger(data.pid) || (data.pid as number) <= 0) return null;
    return { pid: data.pid as number, startedAt: Number(data.startedAt) || 0 };
  } catch {
    return null;
  }
}

function heldMessage(info: LockInfo, dataDir: string): string {
  return (
    `claude-agent-ui is already running for this state directory (PID ${info.pid}).\n` +
    `Stop that server first, or run this one against another directory: ` +
    `claude-agent-ui --data-dir <path>\n` +
    `If you are sure PID ${info.pid} is gone, delete ${path.join(dataDir, LOCK_FILE)} and try again.`
  );
}

export interface AcquireLockOptions {
  pid?: number;
  /** Test seam for process liveness; defaults to a signal-0 probe. */
  isAlive?: (pid: number) => boolean;
}

/**
 * Takes the exclusive lock on a state directory, so two servers never write the same JSON files.
 *
 * A lockfile left behind by a crashed server is reclaimed once its pid is gone — the alternative is
 * a UI that refuses to start after an unclean shutdown. The create is `wx`, so two processes racing
 * for a free lock cannot both win.
 */
export async function acquireLock(dataDir: string, opts: AcquireLockOptions = {}): Promise<Lock> {
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? ((p: number) => isProcessAlive(p));
  const file = path.join(dataDir, LOCK_FILE);
  await mkdir(dataDir, { recursive: true });
  const info: LockInfo = { pid, startedAt: Date.now() };

  // Two passes at most: one to claim it, one more after clearing a lock whose owner is gone.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, "wx");
      try {
        await handle.writeFile(JSON.stringify(info), "utf8");
      } finally {
        await handle.close();
      }
      return makeLock(file, info);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    let existing: LockInfo | null;
    try {
      existing = parseLock(await readFile(file, "utf8"));
    } catch (err) {
      // Someone released it between our create and our read; go around and claim it.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    // A truncated or unparseable lockfile is a crash artefact, not a running server.
    if (existing && isAlive(existing.pid)) throw new LockError(heldMessage(existing, dataDir));
    await rm(file, { force: true });
  }

  // Only reachable if another process keeps re-taking the lock as fast as we clear it.
  throw new LockError(
    `Could not take the lock on ${dataDir}: another process keeps claiming ${LOCK_FILE}.\n` +
      `Stop any running claude-agent-ui and try again.`,
  );
}

function makeLock(file: string, info: LockInfo): Lock {
  let released = false;
  return {
    file,
    info,
    release() {
      if (released) return;
      released = true;
      // Only remove the file if it is still the one we wrote: a stale-lock takeover by a later
      // server must not have its lock deleted by our shutdown.
      try {
        const current = parseLock(readFileSync(file, "utf8"));
        if (current?.pid !== info.pid || current.startedAt !== info.startedAt) return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      rmSync(file, { force: true });
    },
  };
}
