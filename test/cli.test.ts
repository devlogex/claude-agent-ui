import assert from "node:assert/strict";
import { test } from "node:test";
import { checkClaudeBinary, checkNodeVersion, readVersion } from "../src/cli.ts";

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
  assert.equal(await checkClaudeBinary("true"), null);
});

test("readVersion reports the package version", () => {
  assert.match(readVersion(), /^\d+\.\d+\.\d+/);
});
