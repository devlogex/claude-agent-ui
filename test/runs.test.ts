import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { CliError, ClaudeCli, type BackgroundSession } from "../src/claudeCli.ts";
import { MAX_PROMPT_LENGTH, RunStore, mapStatus } from "../src/runs.ts";
import { put, tempHome } from "./helpers.ts";

test("mapStatus: busy→running, idle→finished, stopped, missing", () => {
  const base = { id: "a", sessionId: "s", cwd: "/", kind: "background" };
  assert.equal(mapStatus({ ...base, pid: 1, status: "busy", state: "working" }), "running");
  assert.equal(mapStatus({ ...base, pid: 1, status: "idle", state: "blocked" }), "finished");
  assert.equal(mapStatus({ ...base, pid: 1, status: "idle", state: "done" }), "finished");
  assert.equal(mapStatus({ ...base, state: "stopped" }), "stopped");
  assert.equal(mapStatus(undefined), "missing");
});

class FakeCli extends ClaudeCli {
  sessions: BackgroundSession[] = [];
  startError: string | null = null;
  removeError: string | null = null;
  listError: string | null = null;
  calls: string[] = [];
  constructor() {
    super(async () => ({ stdout: "", stderr: "" }));
  }
  async startBackground(opts: { agent: string; cwd: string; prompt: string; unattended?: boolean }) {
    this.calls.push(`bg ${opts.agent} ${opts.cwd} ${opts.prompt}${opts.unattended ? " [unattended]" : ""}`);
    if (this.startError) throw new CliError(this.startError, this.startError);
    this.sessions.push({ id: "abcd1234", sessionId: "abcd1234-full", pid: 9, cwd: opts.cwd, kind: "background", status: "busy" });
    return "abcd1234";
  }
  async listSessions() {
    if (this.listError) throw new CliError(this.listError, this.listError);
    return this.sessions;
  }
  async stop(id: string) {
    this.calls.push(`stop ${id}`);
  }
  async remove(id: string) {
    this.calls.push(`rm ${id}`);
    if (this.removeError) throw new CliError(this.removeError, this.removeError);
  }
}

async function setup() {
  const home = await tempHome();
  const cli = new FakeCli();
  return { home, cli, store: new RunStore(home, cli, "Start your task.") };
}

test("start persists the run with its session id", async () => {
  const { home, cli, store } = await setup();
  const run = await store.start("omc:executor", home);
  assert.equal(run.runId, "abcd1234");
  assert.equal(run.sessionId, "abcd1234-full");
  assert.deepEqual(cli.calls, [`bg omc:executor ${home} Start your task.`]);
  const saved = JSON.parse(await readFile(path.join(home, ".claude-agent-ui", "runs.json"), "utf8"));
  assert.equal(saved[0].runId, "abcd1234");
});

test("start passes a custom prompt through unchanged", async () => {
  const { home, cli, store } = await setup();
  await store.start("omc:executor", home, "  Fix bug X\n");
  assert.deepEqual(cli.calls, [`bg omc:executor ${home}   Fix bug X\n`]);
});

test("start falls back to the starter prompt for a missing or blank prompt", async () => {
  const { home, cli, store } = await setup();
  for (const prompt of [undefined, null, "", "   \n"]) await store.start("a", home, prompt);
  assert.deepEqual(cli.calls, Array(4).fill(`bg a ${home} Start your task.`));
});

test("start passes unattended through and defaults it to off", async () => {
  const { home, cli, store } = await setup();
  await store.start("a", home, "go", true);
  await store.start("a", home, "go", null);
  assert.deepEqual(cli.calls, [`bg a ${home} go [unattended]`, `bg a ${home} go`]);
  await assert.rejects(store.start("a", home, "go", "yes"), (err: any) => err.status === 400);
});

test("start rejects a non-string or over-long prompt before calling the CLI", async () => {
  const { home, cli, store } = await setup();
  for (const prompt of [42, { text: "x" }, ["x"], "x".repeat(MAX_PROMPT_LENGTH + 1), "a\0b"]) {
    await assert.rejects(store.start("a", home, prompt), (err: any) => err.status === 400);
  }
  assert.deepEqual(cli.calls, []);
});

test("start validates the working directory", async () => {
  const { store } = await setup();
  await assert.rejects(store.start("a", "relative/dir"), /absolute/);
  await assert.rejects(store.start("a", "/definitely/not/here"), /does not exist/);
});

test("trust error gets a plain-language hint", async () => {
  const { home, cli, store } = await setup();
  cli.startError = "Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.";
  await assert.rejects(store.start("a", home), (err: any) => err.status === 502 && /accept the trust prompt once/.test(err.message));
});

test("list: running has no final text; finished reads it from the transcript", async () => {
  const { home, cli, store } = await setup();
  await store.start("a", home);
  let [view] = (await store.list()).runs;
  assert.equal(view.status, "running");
  assert.equal(view.finalText, null);
  assert.equal(view.attachCommand, "claude attach abcd1234");

  await put(
    path.join(home, ".claude", "projects", "-x", "abcd1234-full.jsonl"),
    JSON.stringify({ type: "assistant", timestamp: "2026-09-30T04:24:33.613Z", message: { id: "m", content: [{ type: "text", text: "All done." }] } }),
  );
  cli.sessions[0].status = "idle";
  [view] = (await store.list()).runs;
  assert.equal(view.status, "finished");
  assert.equal(view.finalText, "All done.");
  assert.equal(view.endedAt, Date.parse("2026-09-30T04:24:33.613Z"));

  cli.sessions = [];
  [view] = (await store.list()).runs;
  assert.equal(view.status, "missing");
});

test("remove forgets the run even when the session is already gone", async () => {
  const { home, cli, store } = await setup();
  await store.start("a", home);
  cli.removeError = "some future wording";
  cli.sessions = [];
  await store.remove("abcd1234");
  assert.deepEqual((await store.list()).runs, []);
  await assert.rejects(store.remove("abcd1234"), /not found/);
});

test("stopFinished stops only idle runs", async () => {
  const { home, cli, store } = await setup();
  await store.start("a", home);
  assert.deepEqual(await store.stopFinished(), []);
  cli.sessions[0].status = "idle";
  assert.deepEqual(await store.stopFinished(), ["abcd1234"]);
  assert.ok(cli.calls.includes("stop abcd1234"));
});

test("start rejects option-like agent names and expands ~ in cwd", async () => {
  const { home, cli, store } = await setup();
  await assert.rejects(store.start("--foo", home), /invalid agent name/);
  const run = await store.start("omc:executor", "~");
  assert.equal(run.cwd, home);
  assert.deepEqual(cli.calls, [`bg omc:executor ${home} Start your task.`]);
});

test("list survives a failing claude agents call", async () => {
  const { home, cli, store } = await setup();
  await store.start("a", home);
  cli.listError = "timeout";
  const { runs, warning } = await store.list();
  assert.equal(runs[0].status, "unknown");
  assert.match(warning!, /timeout/);
});

test("remove keeps the run when the session still exists and rm fails", async () => {
  const { home, cli, store } = await setup();
  await store.start("a", home);
  cli.removeError = "boom";
  await assert.rejects(store.remove("abcd1234"), /claude rm failed/);
  assert.equal((await store.list()).runs.length, 1);
});

test("a corrupt runs.json is an error, not silently replaced", async () => {
  const { home, store } = await setup();
  await put(path.join(home, ".claude-agent-ui", "runs.json"), "{not json");
  await assert.rejects(store.list());
  assert.equal(await readFile(path.join(home, ".claude-agent-ui", "runs.json"), "utf8"), "{not json");
});
