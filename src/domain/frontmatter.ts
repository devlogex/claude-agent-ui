import { parse } from "yaml";
import type { FieldError } from "./errors.ts";

export interface ParsedFile {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/** Parses YAML frontmatter; throws with a readable message when missing or invalid. */
export function parseFrontmatter(content: string): ParsedFile {
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

/** `name` doubles as a filename (agents) or a directory name (skills), so it has to be path-safe. */
export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface Checked extends Partial<ParsedFile> {
  /** Empty when the content is valid. Reported together so an editor can mark every bad key at once. */
  fields: FieldError[];
  /** Trimmed `name` from the frontmatter; only set when there is no `name` error. */
  name?: string;
}

/**
 * Checks the `name`/`description` frontmatter shared by agent and skill files.
 *
 * Never throws: it returns the problems so callers can turn them into either a structured 400 or
 * the live feedback the editor shows while the user is still typing.
 */
export function checkDefinition(content: unknown): Checked {
  if (typeof content !== "string" || !content.trim()) {
    return { fields: [{ field: "content", message: "the file is empty" }] };
  }
  let parsed: ParsedFile;
  try {
    parsed = parseFrontmatter(content);
  } catch (err) {
    return { fields: [{ field: "frontmatter", message: (err as Error).message }] };
  }

  const fields: FieldError[] = [];
  const { name, description } = parsed.data;
  if (typeof name !== "string" || !name.trim()) {
    fields.push({ field: "name", message: "`name` is required" });
  } else if (!NAME_RE.test(name)) {
    fields.push({
      field: "name",
      message: "`name` must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, dashes)",
    });
  }
  if (typeof description !== "string" || !description.trim()) {
    fields.push({ field: "description", message: "`description` is required" });
  }

  return { ...parsed, fields, name: fields.some((f) => f.field === "name") ? undefined : (name as string) };
}
