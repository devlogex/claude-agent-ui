import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { JsonStore, writeFileAtomic } from "../src/store/jsonStore.ts";
import { put, tempHome } from "./helpers.ts";

const store = <T>(dir: string, empty: () => T, name = "state.json") => new JsonStore<T>(path.join(dir, name), empty);

test("read returns the empty value when the file does not exist", async () => {
  const dir = await tempHome();
  assert.deepEqual(await store<number[]>(dir, () => []).read(), []);
});

test("mutate creates the directory and writes the value back", async () => {
  const dir = path.join(await tempHome(), "nested", "deeper");
  const s = store<number[]>(dir, () => []);
  const result = await s.mutate((v) => {
    v.push(1, 2);
    return v.length;
  });
  assert.equal(result, 2);
  assert.deepEqual(JSON.parse(await readFile(s.file, "utf8")), [1, 2]);
});

test("concurrent mutations are serialised, so none is lost", async () => {
  const dir = await tempHome();
  const s = store<number[]>(dir, () => []);
  await Promise.all(Array.from({ length: 25 }, (_, i) => s.mutate((v) => v.push(i))));
  const saved: number[] = JSON.parse(await readFile(s.file, "utf8"));
  assert.deepEqual(
    [...saved].sort((a, b) => a - b),
    Array.from({ length: 25 }, (_, i) => i),
  );
});

test("a failed mutation rejects for its caller but does not break the chain", async () => {
  const dir = await tempHome();
  const s = store<number[]>(dir, () => []);
  await s.mutate((v) => v.push(1));
  await assert.rejects(
    s.mutate(() => {
      throw new Error("boom");
    }),
    /boom/,
  );
  await s.mutate((v) => v.push(2));
  assert.deepEqual(JSON.parse(await readFile(s.file, "utf8")), [1, 2]);
});

test("an unreadable file is an error, not a silent reset", async () => {
  const dir = await tempHome();
  const s = store<number[]>(dir, () => []);
  await put(s.file, "{not json");
  await assert.rejects(s.read());
  await assert.rejects(s.mutate((v) => v.push(1)));
  assert.equal(await readFile(s.file, "utf8"), "{not json");
});

test("writeFileAtomic replaces the file and leaves no temp file behind", async () => {
  const dir = await tempHome();
  const file = path.join(dir, "state.json");
  await writeFile(file, "old");
  await writeFileAtomic(file, "new");
  assert.equal(await readFile(file, "utf8"), "new");
  assert.deepEqual(
    (await readdir(dir)).filter((f) => f.endsWith(".tmp")),
    [],
  );
});

test("two stores on the same file do not collide on their temp paths", async () => {
  const dir = await tempHome();
  const file = path.join(dir, "state.json");
  const a = new JsonStore<number[]>(file, () => []);
  const b = new JsonStore<number[]>(file, () => []);
  await Promise.all([a.mutate((v) => v.push(1)), b.mutate((v) => v.push(2))]);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(Array.isArray(saved), true);
  assert.deepEqual(
    (await readdir(dir)).filter((f) => f.endsWith(".tmp")),
    [],
  );
});
