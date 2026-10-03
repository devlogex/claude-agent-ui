import assert from "node:assert/strict";
import { access, readFile, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { discoverAgents } from "../src/domain/agents.ts";
import {
  assertInsideAgentsDir,
  createAgent,
  deleteAgent,
  updateAgent,
  validateAgentContent,
} from "../src/domain/agentStore.ts";
import { agentMd, fixtureHome, fixtureProject, put, tempHome } from "./helpers.ts";

const rejects = (p: Promise<unknown>, re: RegExp, status: number) =>
  assert.rejects(p, (err: any) => re.test(err.message) && err.status === status);

const missing = (file: string) => access(file).then(() => false, () => true);

test("create writes ~/.claude/agents/<name>.md, creating the folder", async () => {
  const home = await tempHome();
  const { file, scope } = await createAgent(home, agentMd("new-one"));
  assert.equal(file, path.join(home, ".claude", "agents", "new-one.md"));
  assert.equal(scope, "user");
  assert.equal(await readFile(file, "utf8"), agentMd("new-one"));
});

test("create writes to the project directory when asked, and the id matches discovery", async () => {
  const [home, project] = [await fixtureHome(), await fixtureProject()];
  const { id, file } = await createAgent(home, agentMd("shipper"), { projectDir: project, scope: "project" });
  assert.equal(file, path.join(project, ".claude", "agents", "shipper.md"));
  const found = (await discoverAgents(home, project)).find((a) => a.name === "shipper")!;
  assert.equal(found.id, id);
  assert.equal(found.scope, "project");
});

test("create rejects an unknown scope and a project scope with no project", async () => {
  const home = await fixtureHome();
  await rejects(createAgent(home, agentMd("x"), { scope: "plugin" }), /scope must be/, 400);
  await rejects(createAgent(home, agentMd("x"), { scope: "project", projectDir: home }), /no separate project/, 400);
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

test("validation errors name the field, and report every bad field at once", () => {
  const err = (content: string) => {
    try {
      validateAgentContent(content);
    } catch (e: any) {
      return e;
    }
    throw new Error("expected a rejection");
  };
  assert.deepEqual(err("").fields, [{ field: "content", message: "the file is empty" }]);
  assert.deepEqual(err("no frontmatter").fields.map((f: any) => f.field), ["frontmatter"]);
  // Both keys are wrong; the editor must be able to mark both, not just the first.
  assert.deepEqual(err("---\nname: Bad_Name\ndescription: ''\n---\n").fields.map((f: any) => f.field), [
    "name",
    "description",
  ]);
  assert.match(err("---\nname: Bad_Name\n---\n").fields[0].message, /\^\[a-z0-9\]/);
});

test("update rewrites a user agent in place", async () => {
  const home = await fixtureHome();
  const alpha = (await discoverAgents(home)).find((a) => a.runName === "alpha")!;
  const next = agentMd("alpha", "Changed");
  await updateAgent(home, alpha.id, next);
  assert.equal(await readFile(alpha.filePath, "utf8"), next);
});

test("update rewrites a project agent in place", async () => {
  const [home, project] = [await fixtureHome(), await fixtureProject()];
  const deployer = (await discoverAgents(home, project)).find((a) => a.name === "deployer")!;
  const next = agentMd("deployer", "Changed");
  await updateAgent(home, deployer.id, next, project);
  assert.equal(await readFile(deployer.filePath, "utf8"), next);
});

test("update refuses plugin agents and unknown ids", async () => {
  const home = await fixtureHome();
  const plugin = (await discoverAgents(home)).find((a) => a.scope === "plugin")!;
  await rejects(updateAgent(home, plugin.id, agentMd("executor")), /omc plugin/, 403);
  await rejects(updateAgent(home, "nope", agentMd("x")), /not found/, 404);
});

test("delete removes the file, and refuses plugin agents and unknown ids", async () => {
  const home = await fixtureHome();
  const alpha = (await discoverAgents(home)).find((a) => a.runName === "alpha")!;
  await deleteAgent(home, alpha.id);
  assert.ok(await missing(alpha.filePath));
  assert.equal(
    (await discoverAgents(home)).some((a) => a.id === alpha.id),
    false,
  );
  const plugin = (await discoverAgents(home)).find((a) => a.scope === "plugin")!;
  await rejects(deleteAgent(home, plugin.id), /omc plugin/, 403);
  await rejects(deleteAgent(home, "nope"), /not found/, 404);
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
  // Deleting a link removes the link, never the file it points at.
  await deleteAgent(home, agent.id);
  assert.ok(await missing(link));
  assert.equal(await readFile(real, "utf8"), agentMd("linked", "Edited"));
});

test("create and update leave no temp files behind", async () => {
  const home = await fixtureHome();
  await createAgent(home, agentMd("gamma"));
  await rejects(createAgent(home, agentMd("gamma")), /already exists/, 409);
  const files = await readdir(path.join(home, ".claude", "agents"));
  assert.deepEqual(
    files.filter((f) => f.endsWith(".tmp")),
    [],
  );
});
