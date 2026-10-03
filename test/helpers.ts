import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function tempHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "agent-ui-test-"));
}

export async function put(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

export const agentMd = (name: string, description = `${name} agent`, extra = "") =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody of ${name}.\n`;

export const skillMd = (name: string, description = `${name} skill`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody of ${name}.\n`;

/**
 * Builds a fake ~/.claude with user agents and skills and three plugins (enabled user, disabled,
 * project-scope). Only the enabled user-scope plugin's definitions should ever be listed.
 */
export async function fixtureHome(): Promise<string> {
  const home = await tempHome();
  const c = path.join(home, ".claude");
  await put(path.join(c, "agents", "alpha.md"), agentMd("alpha", "Alpha agent", "model: sonnet\n"));
  await put(path.join(c, "agents", "nested", "beta.md"), agentMd("beta"));
  await put(path.join(c, "agents", "broken.md"), "---\nname: [unclosed\n---\nbody\n");
  await put(path.join(c, "skills", "writing", "SKILL.md"), skillMd("writing", "Writes things"));
  await put(path.join(c, "skills", "broken-skill", "SKILL.md"), "---\nname: [unclosed\n---\nbody\n");
  // A directory with no SKILL.md is not a skill, and neither is a loose file in the skills root.
  await put(path.join(c, "skills", "notaskill", "README.md"), "nothing here\n");
  await put(path.join(c, "skills", "loose.md"), skillMd("loose"));
  const plugin = (name: string) => path.join(c, "plugins", "cache", "mk", name, "1.0.0");
  await put(path.join(plugin("omc"), "agents", "executor.md"), agentMd("executor", "Executes"));
  await put(path.join(plugin("omc"), "skills", "ralph", "SKILL.md"), skillMd("ralph", "Loops"));
  await put(path.join(plugin("off"), "agents", "hidden.md"), agentMd("hidden"));
  await put(path.join(plugin("off"), "skills", "hidden-skill", "SKILL.md"), skillMd("hidden-skill"));
  await put(path.join(plugin("proj"), "agents", "projonly.md"), agentMd("projonly"));
  await put(
    path.join(c, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "omc@mk": [{ scope: "user", installPath: plugin("omc") }],
        "off@mk": [{ scope: "user", installPath: plugin("off") }],
        "proj@mk": [{ scope: "project", projectPath: "/x", installPath: plugin("proj") }],
      },
    }),
  );
  await put(
    path.join(c, "settings.json"),
    JSON.stringify({ enabledPlugins: { "omc@mk": true, "off@mk": false, "proj@mk": true } }),
  );
  return home;
}

/** A project directory with its own `.claude/agents` and `.claude/skills`, outside any home. */
export async function fixtureProject(): Promise<string> {
  const dir = await tempHome();
  await put(path.join(dir, ".claude", "agents", "deployer.md"), agentMd("deployer", "Deploys this repo"));
  await put(path.join(dir, ".claude", "skills", "release", "SKILL.md"), skillMd("release", "Cuts a release"));
  return dir;
}
