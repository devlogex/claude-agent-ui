import assert from "node:assert/strict";
import { test } from "node:test";
import { CliError, ClaudeCli, UNATTENDED_PROMPT, parseBgOutput, parseSessions, type CliRunner } from "../src/claudeCli.ts";

// Captured from `claude --bg` (v2.1.285).
const BG_OUTPUT = "Starting background service…\nbackgrounded · d8ff422b\n  claude agents             list sessions\n  claude attach d8ff422b    open in this terminal\n";
const AGENTS_JSON = JSON.stringify([
  { pid: 1, cwd: "/w", kind: "interactive", sessionId: "aaaa", name: "x", status: "busy" },
  { pid: 2, id: "308b77ec", cwd: "/w", kind: "background", sessionId: "308b77ec-f59b", status: "idle", state: "done" },
  { id: "f96aab94", cwd: "/w", kind: "background", sessionId: "f96aab94-ef63", state: "stopped" },
]);

test("parseBgOutput extracts the short id", () => {
  assert.equal(parseBgOutput(BG_OUTPUT), "d8ff422b");
  assert.throws(() => parseBgOutput("something else"), CliError);
});

test("parseSessions keeps entries with a sessionId", () => {
  const sessions = parseSessions(AGENTS_JSON);
  assert.equal(sessions.length, 3);
  assert.equal(sessions[2].state, "stopped");
  assert.throws(() => parseSessions("{}"), /array/);
});

function fakeRunner(result: { stdout?: string; error?: string }) {
  const calls: { args: string[]; cwd?: string }[] = [];
  const run: CliRunner = async (args, opts = {}) => {
    calls.push({ args, cwd: opts.cwd });
    if (result.error) throw new CliError(result.error, result.error);
    return { stdout: result.stdout ?? "", stderr: "" };
  };
  return { run, calls };
}

test("startBackground passes an argument array with agent, bypass and prompt", async () => {
  const { run, calls } = fakeRunner({ stdout: BG_OUTPUT });
  const id = await new ClaudeCli(run).startBackground({ agent: "omc:executor", cwd: "/tmp/w", prompt: "Start; rm -rf / `x`" });
  assert.equal(id, "d8ff422b");
  assert.deepEqual(calls[0], {
    args: ["--bg", "--agent", "omc:executor", "--dangerously-skip-permissions", "--", "Start; rm -rf / `x`"],
    cwd: "/tmp/w",
  });
});

test("startBackground in unattended mode removes AskUserQuestion and adds the no-questions rule before the prompt", async () => {
  const { run, calls } = fakeRunner({ stdout: BG_OUTPUT });
  await new ClaudeCli(run).startBackground({ agent: "a", cwd: "/tmp/w", prompt: "go", unattended: true });
  assert.deepEqual(calls[0].args, [
    "--bg", "--agent", "a", "--dangerously-skip-permissions",
    "--disallowedTools=AskUserQuestion", "--append-system-prompt", UNATTENDED_PROMPT,
    "--", "go",
  ]);
});

test("startBackground keeps a prompt that looks like a flag positional", async () => {
  const { run, calls } = fakeRunner({ stdout: BG_OUTPUT });
  await new ClaudeCli(run).startBackground({ agent: "a", cwd: "/tmp/w", prompt: "--help" });
  assert.deepEqual(calls[0].args.slice(-2), ["--", "--help"]);
});

test("startBackground surfaces the CLI error without ANSI codes", async () => {
  const { run } = fakeRunner({ error: "\x1b[31mWorkspace not trusted. Run `claude` in /x once\x1b[0m" });
  await assert.rejects(new ClaudeCli(run).startBackground({ agent: "a", cwd: "/x", prompt: "p" }), (err: any) => err.message === "Workspace not trusted. Run `claude` in /x once");
});

test("listSessions / stop / remove use the expected subcommands", async () => {
  const { run, calls } = fakeRunner({ stdout: AGENTS_JSON });
  const cli = new ClaudeCli(run);
  await cli.listSessions();
  await cli.stop("abc");
  await cli.remove("abc");
  assert.deepEqual(calls.map((c) => c.args), [["agents", "--json", "--all"], ["stop", "abc"], ["rm", "abc"]]);
});
