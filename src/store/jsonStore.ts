import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

function tmpPathFor(file: string): string {
  // The random suffix keeps two processes (or two stores on one file) from sharing a temp path.
  return path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
}

/** Matches the temp names {@link tmpPathFor} produces, and nothing a user would have put there. */
const TEMP_NAME = /^\..+\.[0-9a-f]{12}\.tmp$/;

/**
 * Deletes temp files orphaned by a process that died between writing one and renaming it.
 * Only safe to call while holding the state-directory lock, since a temp file belonging to a
 * running server is a write in flight. Returns how many were removed.
 */
export async function sweepTempFiles(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  let removed = 0;
  for (const name of entries.filter((n) => TEMP_NAME.test(n))) {
    await rm(path.join(dir, name), { force: true });
    removed++;
  }
  return removed;
}

/**
 * Writes `content` to a temp file next to `file`, flushes it to disk, then lets `commit` move it
 * into place. The temp file is always cleaned up, so a crash leaves either the old file or the new
 * one — never a half-written one.
 */
export async function writeViaTemp(
  file: string,
  content: string,
  commit: (tmp: string) => Promise<void>,
): Promise<void> {
  const tmp = tmpPathFor(file);
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(content, "utf8");
      // Without the flush, rename() can land before the bytes do and a power loss truncates the file.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await commit(tmp);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Replaces `file` atomically: write temp, flush, rename over the old file. */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeViaTemp(file, content, (tmp) => rename(tmp, file));
}

/**
 * A single JSON file holding one value, read and written atomically.
 *
 * `mutate` serialises read-modify-write cycles through one promise chain, so two concurrent
 * callers can never read the same snapshot and write over each other.
 */
export class JsonStore<T> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly empty: () => T,
  ) {}

  /** Returns the stored value, or a fresh empty one when the file does not exist yet. */
  async read(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      // Only a missing file means "nothing stored"; any other error must propagate so that a
      // following mutate() never overwrites a file it failed to read.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return this.empty();
      throw err;
    }
    return JSON.parse(raw) as T;
  }

  /**
   * Runs `fn` against the current value, then writes that value back atomically.
   * `fn` mutates the value in place; whatever it returns is handed back to the caller.
   */
  mutate<R>(fn: (value: T) => R | Promise<R>): Promise<R> {
    const next = this.chain.then(async () => {
      const value = await this.read();
      const result = await fn(value);
      await writeFileAtomic(this.file, JSON.stringify(value, null, 2));
      return result;
    });
    // Swallow the rejection on the chain only; `next` still rejects for the caller.
    this.chain = next.catch(() => undefined);
    return next;
  }
}
