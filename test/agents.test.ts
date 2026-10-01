import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverAgents, toPublic } from "../src/agents.ts";
import { fixtureHome, tempHome } from "./helpers.ts";

test("lists global agents (recursive) and enabled user-scope plugin agents", async () => {
  const agents = await discoverAgents(await fixtureHome());
  const byRun = Object.fromEntries(agents.map((a) => [a.runName, a]));
  assert.deepEqual(Object.keys(byRun).sort(), ["alpha", "beta", "broken", "omc:executor"]);
  assert.equal(byRun.alpha.source, "global");
  assert.equal(byRun.alpha.editable, true);
  assert.equal(byRun.alpha.model, "sonnet");
  assert.equal(byRun.alpha.description, "Alpha agent");
  assert.equal(byRun["omc:executor"].source, "plugin:omc");
  assert.equal(byRun["omc:executor"].editable, false);
  assert.equal(byRun["omc:executor"].name, "executor");
});

test("invalid frontmatter is listed, not thrown", async () => {
  const broken = (await discoverAgents(await fixtureHome())).find((a) => a.runName === "broken")!;
  assert.equal(broken.valid, false);
  assert.match(broken.error!, /invalid frontmatter/);
});

test("missing ~/.claude yields an empty list", async () => {
  assert.deepEqual(await discoverAgents(await tempHome()), []);
});

test("public view hides the file path", async () => {
  const [agent] = await discoverAgents(await fixtureHome());
  assert.equal("filePath" in toPublic(agent), false);
});
