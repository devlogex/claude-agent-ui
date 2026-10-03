import { parse } from "yaml";

export interface ParsedAgentFile {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/** Parses YAML frontmatter; throws with a readable message when missing or invalid. */
export function parseAgentFile(content: string): ParsedAgentFile {
  const match = FRONTMATTER.exec(content);
  if (!match) throw new Error("missing frontmatter (file must start with a --- block)");
  let data: unknown;
  try {
    data = parse(match[1]);
  } catch (err) {
    throw new Error(`invalid YAML: ${(err as Error).message.split("\n")[0]}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  return { data: data as Record<string, unknown>, body: match[2] };
}
