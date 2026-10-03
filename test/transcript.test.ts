import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { extractFinalMessage, findTranscript } from "../src/claude/transcript.ts";
import { put, tempHome } from "./helpers.ts";

const line = (o: object) => JSON.stringify(o);
const assistant = (id: string, content: object[], extra: object = {}) =>
  line({ type: "assistant", timestamp: `t-${id}`, message: { id, role: "assistant", content }, ...extra });

test("returns the last assistant text, grouping split message lines", () => {
  const jsonl = [
    line({ type: "user", message: { content: "hi" } }),
    assistant("m1", [{ type: "text", text: "LAUNCHED" }]),
    assistant("m2", [{ type: "thinking", thinking: "..." }]),
    assistant("m2", [{ type: "text", text: "Part A" }]),
    assistant("m2", [{ type: "tool_use", name: "Bash", input: {} }]),
    assistant("m2", [{ type: "text", text: "Part B" }]),
    assistant("s1", [{ type: "text", text: "sidechain" }], { isSidechain: true }),
    "not json",
    "",
  ].join("\n");
  assert.deepEqual(extractFinalMessage(jsonl), { text: "Part A\n\nPart B", timestamp: "t-m2" });
});

test("no assistant text yields null", () => {
  assert.equal(extractFinalMessage(line({ type: "user" })), null);
});

test("findTranscript searches every project folder", async () => {
  const home = await tempHome();
  const file = path.join(home, ".claude", "projects", "-Users-x-Workspace", "abc-123.jsonl");
  await put(file, "");
  assert.equal(await findTranscript(home, "abc-123"), file);
  assert.equal(await findTranscript(home, "missing"), null);
});
