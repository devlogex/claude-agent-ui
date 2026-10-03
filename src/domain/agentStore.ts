import { link, mkdir, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { writeViaTemp } from "../store/jsonStore.ts";
import { agentsDir, findAgent } from "./agents.ts";
import { parseAgentFile } from "./frontmatter.ts";

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const NEW_AGENT_TEMPLATE = `---
name: my-agent
description: One sentence on when this agent should be used
model: sonnet
---

You are ... (describe the agent's job, how it gathers its own context, and what it reports).
`;

export function validateAgentContent(content: string): { name: string } {
  if (typeof content !== "string" || !content.trim()) throw new ValidationError("content is empty");
  let data;
  try {
    ({ data } = parseAgentFile(content));
  } catch (err) {
    throw new ValidationError((err as Error).message);
  }
  if (typeof data.name !== "string" || !data.name) throw new ValidationError("frontmatter `name` is required");
  if (!NAME_RE.test(data.name)) {
    throw new ValidationError("`name` must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, dashes)");
  }
  if (typeof data.description !== "string" || !data.description.trim()) {
    throw new ValidationError("frontmatter `description` is required");
  }
  return { name: data.name };
}

/** Resolves `target` and refuses anything outside the global agents directory. */
export function assertInsideAgentsDir(home: string, target: string): string {
  const root = path.resolve(agentsDir(home));
  const resolved = path.resolve(target);
  if (!resolved.startsWith(root + path.sep)) throw new ValidationError("path is outside ~/.claude/agents", 403);
  return resolved;
}

export async function createAgent(home: string, content: string): Promise<string> {
  const { name } = validateAgentContent(content);
  const dir = agentsDir(home);
  await mkdir(dir, { recursive: true });
  const file = assertInsideAgentsDir(home, path.join(dir, `${name}.md`));
  try {
    // link() fails with EEXIST instead of replacing, so creation is atomic and never overwrites.
    await writeViaTemp(file, content, (tmp) => link(tmp, file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ValidationError(`an agent file named ${name}.md already exists`, 409);
    }
    throw err;
  }
  return file;
}

export async function updateAgent(home: string, id: string, content: string): Promise<string> {
  const agent = await findAgent(home, id);
  if (!agent) throw new ValidationError("agent not found", 404);
  if (!agent.editable) throw new ValidationError("plugin agents are read-only; use Copy to global", 403);
  validateAgentContent(content);
  assertInsideAgentsDir(home, agent.filePath);
  // Write through symlinks so a linked agent keeps pointing at its real file.
  const file = await realpath(agent.filePath);
  await writeViaTemp(file, content, (tmp) => rename(tmp, file));
  return file;
}
