import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseAgentFile } from "./frontmatter.ts";

export interface AgentInfo {
  id: string;
  name: string;
  /** Value passed to `claude --agent`. */
  runName: string;
  description: string;
  model: string | null;
  source: string;
  editable: boolean;
  valid: boolean;
  error: string | null;
  /** Absolute path; server-side only, never sent to the client. */
  filePath: string;
}

export type PublicAgent = Omit<AgentInfo, "filePath">;

export function agentsDir(home: string): string {
  return path.join(home, ".claude", "agents");
}

export function agentId(source: string, filePath: string): string {
  return createHash("sha1").update(`${source}\0${filePath}`).digest("hex").slice(0, 16);
}

export function toPublic({ filePath: _omit, ...rest }: AgentInfo): PublicAgent {
  return rest;
}

async function listMarkdown(dir: string, recursive: boolean): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    if (!e.name.endsWith(".md")) continue;
    const file = path.join(e.parentPath, e.name);
    // Symlinked agent files (e.g. from a dotfiles repo) count if they point at a regular file.
    if (
      e.isFile() ||
      (e.isSymbolicLink() &&
        (await stat(file).then(
          (st) => st.isFile(),
          () => false,
        )))
    ) {
      files.push(file);
    }
  }
  return files.sort();
}

async function readAgent(filePath: string, source: string, editable: boolean, runPrefix: string): Promise<AgentInfo> {
  const fallbackName = path.basename(filePath, ".md");
  const base = { id: agentId(source, filePath), source, editable, filePath };
  try {
    const { data } = parseAgentFile(await readFile(filePath, "utf8"));
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName;
    return {
      ...base,
      name,
      runName: runPrefix + name,
      description: typeof data.description === "string" ? data.description : "",
      model: typeof data.model === "string" ? data.model : null,
      valid: true,
      error: null,
    };
  } catch (err) {
    return {
      ...base,
      name: fallbackName,
      runName: runPrefix + fallbackName,
      description: "",
      model: null,
      valid: false,
      error: `invalid frontmatter: ${(err as Error).message}`,
    };
  }
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

interface PluginInstall {
  plugin: string;
  installPath: string;
}

/** Enabled, user-scope plugins from installed_plugins.json + settings.json enabledPlugins. */
async function enabledUserPlugins(home: string): Promise<PluginInstall[]> {
  const installed = await readJson(path.join(home, ".claude", "plugins", "installed_plugins.json"));
  const settings = await readJson(path.join(home, ".claude", "settings.json"));
  const enabled: Record<string, boolean> = settings?.enabledPlugins ?? {};
  const result: PluginInstall[] = [];
  for (const [key, installs] of Object.entries<any>(installed?.plugins ?? {})) {
    if (enabled[key] !== true || !Array.isArray(installs)) continue;
    const userInstall = installs.find((i) => i?.scope === "user" && typeof i.installPath === "string");
    if (userInstall) result.push({ plugin: key.split("@")[0], installPath: userInstall.installPath });
  }
  return result;
}

export async function discoverAgents(home: string): Promise<AgentInfo[]> {
  const globalFiles = await listMarkdown(agentsDir(home), true);
  const agents = await Promise.all(globalFiles.map((f) => readAgent(f, "global", true, "")));

  for (const { plugin, installPath } of await enabledUserPlugins(home)) {
    const files = await listMarkdown(path.join(installPath, "agents"), false);
    agents.push(...(await Promise.all(files.map((f) => readAgent(f, `plugin:${plugin}`, false, `${plugin}:`)))));
  }
  return agents;
}

export async function findAgent(home: string, id: string): Promise<AgentInfo | undefined> {
  return (await discoverAgents(home)).find((a) => a.id === id);
}
