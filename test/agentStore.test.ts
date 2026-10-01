import assert from "node:assert/strict";
import { readFile, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { discoverAgents } from "../src/agents.ts";
import { assertInsideAgentsDir, createAgent, updateAgent, validateAgentContent } from "../src/agentStore.ts";
import { agentMd, fixtureHome, put, tempHome } from "./helpers.ts";

const rejects = (p: Promise<unknown>, re: RegExp, status: number) =>
  assert.rejects(p, (err: any) => re.test(err.message) && err.status === status);

test("create writes ~/.claude/agents/<name>.md, creating the folder", async () => {
  const home = await tempHome();
  const file = await createAgent(home, agentMd("new-one"));
  assert.equal(file, path.join(home, ".claude", "agents", "new-one.md"));
  assert.equal(await readFile(file, "utf8"), agentMd("new-one"));
});

test("create refuses to overwrite an existing agent", async () => {
  await rejects(createAgent(await fixtureHome(), agentMd("alpha")), /already exists/, 409);
});

test("validation: yaml, required fields, name pattern", () => {
  assert.throws(() => validateAgentContent("no frontmatter"), /missing frontmatter/);
  assert.throws(() => validateAgentContent("---\nname: [x\n---\n"), /invalid YAML/);
  assert.throws(() => validateAgentContent("---\ndescription: d\n---\n"), /`name` is required/);
  assert.throws(() => validateAgentContent(agentMd("Bad_Name")), /must match/);
  assert.throws(() => validateAgentContent(agentMd("../evil")), /must match/);
  assert.throws(() => validateAgentContent("---\nname: ok\n---\n"), /`description` is required/);
  assert.deepEqual(validateAgentContent(agentMd("ok-1")), { name: "ok-1" });
});

test("update rewrites a global agent in place", async () => {
  const home = await fixtureHome();
  const alpha = (await discoverAgents(home)).find((a) => a.runName === "alpha")!;
  const next = agentMd("alpha", "Changed");
  await updateAgent(home, alpha.id, next);
  assert.equal(await readFile(alpha.filePath, "utf8"), next);
});

test("update refuses plugin agents and unknown ids", async () => {
  const home = await fixtureHome();
  const plugin = (await discoverAgents(home)).find((a) => a.source.startsWith("plugin:"))!;
  await rejects(updateAgent(home, plugin.id, agentMd("executor")), /read-only/, 403);
  await rejects(updateAgent(home, "nope", agentMd("x")), /not found/, 404);
});

test("path containment rejects escapes", async () => {
  const home = await tempHome();
  const dir = path.join(home, ".claude", "agents");
  assert.throws(() => assertInsideAgentsDir(home, path.join(dir, "..", "settings.json")), /outside/);
  assert.throws(() => assertInsideAgentsDir(home, dir), /outside/);
  assert.equal(assertInsideAgentsDir(home, path.join(dir, "a.md")), path.join(dir, "a.md"));
});

test("symlinked agents are listed and saved through to the real file", async () => {
  const home = await fixtureHome();
  const real = path.join(home, "dotfiles", "linked.md");
  await put(real, agentMd("linked"));
  const link = path.join(home, ".claude", "agents", "linked.md");
  await symlink(real, link);
  const agent = (await discoverAgents(home)).find((a) => a.runName === "linked")!;
  assert.ok(agent, "symlinked agent is listed");
  await updateAgent(home, agent.id, agentMd("linked", "Edited"));
  assert.equal(await readFile(real, "utf8"), agentMd("linked", "Edited"));
  assert.equal(await readFile(link, "utf8"), agentMd("linked", "Edited"));
});

test("create and update leave no temp files behind", async () => {
  const home = await fixtureHome();
  await createAgent(home, agentMd("gamma"));
  await rejects(createAgent(home, agentMd("gamma")), /already exists/, 409);
  const files = await readdir(path.join(home, ".claude", "agents"));
  assert.deepEqual(files.filter((f) => f.endsWith(".tmp")), []);
});
