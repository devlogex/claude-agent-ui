import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { checkClaudeBinary, checkNodeVersion, main, readVersion } from "../src/cli.ts";
import { tempHome } from "./helpers.ts";

test("the Node preflight explains what to do, and passes on supported versions", () => {
  assert.match(checkNodeVersion("v18.20.0")!, /needs Node 20 or newer/);
  assert.match(checkNodeVersion("v18.20.0")!, /nvm install 20/);
  assert.equal(checkNodeVersion("v20.0.0"), null);
  assert.equal(checkNodeVersion("v24.21.0"), null);
  assert.equal(checkNodeVersion("not-a-version"), null);
});

test("the claude preflight names the binary and how to point at another one", async () => {
  // A path that cannot exist, so this never depends on a real claude install.
  const problem = await checkClaudeBinary("/nonexistent/claude-agent-ui-preflight-probe");
  assert.match(problem!, /Could not run the Claude Code CLI/);
  assert.match(problem!, /--claude-bin/);
  assert.match(problem!, /CLAUDE_AGENT_UI_CLAUDE_BIN/);
});

test("the claude preflight passes for a binary that exits cleanly", async () => {
  // node --version succeeds everywhere, so this does not assume a POSIX shell environment.
  assert.equal(await checkClaudeBinary(process.execPath), null);
});

test("readVersion reports the package version", () => {
  assert.match(readVersion(), /^\d+\.\d+\.\d+/);
});

/** Runs main() with stdout captured, so a test can read the URL the CLI advertises. */
async function runMain(argv: string[]): Promise<{ server: Awaited<ReturnType<typeof main>>; out: string }> {
  const chunks: string[] = [];
  const real = process.stdout.write;
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { server: await main(argv), out: chunks.join("") };
  } finally {
    process.stdout.write = real;
  }
}

// Regression: --port 0 used to print a working-looking URL that the loopback guard then refused,
// because the guard was built from the requested 0 rather than the port the OS actually bound.
test("--port 0 prints a URL the server actually serves", async () => {
  const home = await tempHome();
  const { server, out } = await runMain([
    "--port",
    "0",
    "--data-dir",
    path.join(home, ".claude-agent-ui"),
    "--claude-bin",
    process.execPath,
  ]);
  assert.ok(server, "main should return the listening server");
  try {
    const url = /Claude Agent UI: (\S+)/.exec(out)?.[1];
    assert.ok(url, `no URL in output: ${out}`);
    assert.doesNotMatch(url, /:0$/);
    const res = await fetch(`${url}/api/config`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { permissionMode: string }).permissionMode, "ask");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
