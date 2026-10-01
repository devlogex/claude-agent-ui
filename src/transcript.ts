import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Finds ~/.claude/projects/<any>/<sessionId>.jsonl without recomputing the cwd slug. */
export async function findTranscript(home: string, sessionId: string): Promise<string | null> {
  const root = path.join(home, ".claude", "projects");
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const candidate = path.join(root, dir.name, `${sessionId}.jsonl`);
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // not in this project folder
    }
  }
  return null;
}

export interface FinalMessage {
  text: string;
  timestamp: string | null;
}

/**
 * Returns the text of the last assistant message that has text.
 * One API message can be split over several lines sharing message.id, so text blocks are grouped by id.
 */
export function extractFinalMessage(jsonl: string): FinalMessage | null {
  let lastId: string | null = null;
  let parts: string[] = [];
  let timestamp: string | null = null;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant" || entry.isSidechain) continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const texts = content.filter((c: any) => c?.type === "text" && typeof c.text === "string").map((c: any) => c.text);
    if (!texts.length) continue;
    const id = entry.message?.id ?? entry.uuid ?? null;
    if (id === null || id !== lastId) {
      lastId = id;
      parts = [];
    }
    parts.push(...texts);
    timestamp = entry.timestamp ?? timestamp;
  }
  return lastId === null && !parts.length ? null : { text: parts.join("\n\n").trim(), timestamp };
}

export async function readFinalMessage(file: string): Promise<FinalMessage | null> {
  return extractFinalMessage(await readFile(file, "utf8"));
}
