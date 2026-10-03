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

/**
 * `name` doubles as a filename (agents) or a directory name (skills), so a name we are about to
 * build a path from has to be path-safe.
 *
 * This is deliberately stricter than what Claude Code itself accepts, and it is therefore applied
 * only on create. A file already on disk is addressed by its own path, so `Code-Reviewer` — legal
 * to Claude Code, and unreachable through this regex — must still be editable and runnable here.
 */
export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface Checked extends Partial<ParsedFile> {
  /** Empty when the content is valid. Reported together so an editor can mark every bad key at once. */
  fields: FieldError[];
  /** Trimmed `name` from the frontmatter; only set when there is no `name` error. */
  name?: string;
}

export interface CheckOptions {
  /**
   * Also require `name` to satisfy `NAME_RE`, because the caller is about to turn it into a new
   * file or directory name. Off for every check of a file that already exists.
   */
  forNewPath?: boolean;
}

/**
 * Checks the `name`/`description` frontmatter shared by agent and skill files.
 *
 * The default rules are the ones Claude Code applies before it will load a definition at all:
 * the frontmatter has to parse, `name` has to be there and carry neither a leading `-` nor the
 * `:` reserved for plugin-scoped ids, and `description` has to say when to reach for the file.
 * `forNewPath` adds our own, stricter path-safety rule on top.
 *
 * Never throws: it returns the problems so callers can turn them into either a structured 400 or
 * the live feedback the editor shows while the user is still typing.
 */
export function checkDefinition(content: unknown, opts: CheckOptions = {}): Checked {
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
  } else if (name.includes(":")) {
    // Claude Code reserves `:` for plugin-scoped ids and refuses to load the file otherwise.
    fields.push({ field: "name", message: "`name` cannot contain `:`, which is reserved for plugin names" });
  } else if (name.startsWith("-")) {
    fields.push({ field: "name", message: "`name` cannot start with `-`" });
  } else if (opts.forNewPath && !NAME_RE.test(name)) {
    fields.push({
      field: "name",
      message: "`name` must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, dashes)",
    });
  }
  if (typeof description !== "string" || !description.trim()) {
    fields.push({ field: "description", message: "`description` is required" });
  }

  return { ...parsed, fields, name: fields.some((f) => f.field === "name") ? undefined : (name as string).trim() };
}

/**
 * One sentence for a list row, from the problems `checkDefinition` found. Null when there are none.
 *
 * A frontmatter failure keeps its own wording because it is the one problem that explains why
 * every other field is missing; the rest are joined so a row names each bad key.
 */
export function describeFields(fields: FieldError[]): string | null {
  if (fields.length === 0) return null;
  const broken = fields.find((f) => f.field === "frontmatter");
  if (broken) return `invalid frontmatter: ${broken.message}`;
  return fields.map((f) => f.message).join("; ");
}
