import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.ts";
import { ConfigError } from "../src/config.ts";
import { LOCK_FILE, LockError, acquireLock, isProcessAlive } from "../src/store/lockfile.ts";
import { tempHome } from "./helpers.ts";

const never = () => false;
const always = () => true;

test("isProcessAlive reads a signal-0 probe: ESRCH is gone, EPERM is running", () => {
  const fail = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(1234, fail("ESRCH") as never), false);
  // Another user's process still owns the directory, even though we may not signal it.
  assert.equal(isProcessAlive(1234, fail("EPERM") as never), true);
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(-1), false);
});

test("a second server is refused, and the message names the running PID", async () => {
  const dir = await tempHome();
  const first = await acquireLock(dir, { pid: 4242, isAlive: always });
  await assert.rejects(acquireLock(dir, { pid: 7, isAlive: always }), (err: unknown) => {
    assert.ok(err instanceof LockError);
    assert.match(err.message, /already running for this state directory \(PID 4242\)/);
    assert.match(err.message, /--data-dir/);
    assert.match(err.message, new RegExp(path.join(dir, LOCK_FILE).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return true;
  });
  first.release();
});

test("releasing the lock lets the next server start, and releasing twice is harmless", async () => {
  const dir = await tempHome();
  const first = await acquireLock(dir, { pid: 4242, isAlive: always });
  first.release();
  first.release();
  const second = await acquireLock(dir, { pid: 99, isAlive: always });
  assert.equal(second.info.pid, 99);
  second.release();
});

test("a lock left by a crashed server is reclaimed once its PID is gone", async () => {
  const dir = await tempHome();
  const crashed = await acquireLock(dir, { pid: 4242, isAlive: always });
  assert.equal(JSON.parse(await readFile(crashed.file, "utf8")).pid, 4242);
  // Same directory, but nothing is running under 4242 any more.
  const next = await acquireLock(dir, { pid: 99, isAlive: never });
  assert.equal(JSON.parse(await readFile(next.file, "utf8")).pid, 99);
  next.release();
});

test("a truncated or garbage lockfile is treated as a crash artefact, not a running server", async () => {
  for (const content of ["", "{not json", '{"pid":"nope"}', '{"pid":0}']) {
    const dir = await tempHome();
    await writeFile(path.join(dir, LOCK_FILE), content);
    const lock = await acquireLock(dir, { pid: 99, isAlive: always });
    assert.equal(lock.info.pid, 99);
    lock.release();
  }
});

test("release does not delete a lock another server has since taken over", async () => {
  const dir = await tempHome();
  const crashed = await acquireLock(dir, { pid: 4242, isAlive: always });
  const taker = await acquireLock(dir, { pid: 99, isAlive: never });
  // The first owner shutting down late must not hand the directory to a third server.
  crashed.release();
  assert.equal(JSON.parse(await readFile(taker.file, "utf8")).pid, 99);
  await assert.rejects(acquireLock(dir, { pid: 7, isAlive: always }), /PID 99/);
  taker.release();
});

/** Starts a server through main() the way the bin entry does, minus the browser. */
function start(dataDir: string) {
  return main(["--port", "0", "--data-dir", dataDir, "--claude-bin", process.execPath, "--no-open"]);
}

test("two servers on one state directory: the second exits with the first one's PID", async () => {
  const dataDir = path.join(await tempHome(), ".claude-agent-ui");
  const server = await start(dataDir);
  assert.ok(server);
  try {
    await assert.rejects(start(dataDir), (err: unknown) => {
      assert.ok(err instanceof ConfigError, `expected a ConfigError, got ${String(err)}`);
      assert.match(err.message, new RegExp(`PID ${process.pid}\\b`));
      assert.doesNotMatch(err.message, /at .*:\d+:\d+/, "the message must not be a stack trace");
      return true;
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  // Once the first server is down the directory is free again.
  const third = await start(dataDir);
  assert.ok(third);
  await new Promise((resolve) => third.close(resolve));
});
