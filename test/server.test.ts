import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { ClaudeCli } from "../src/claudeCli.ts";
import { createApp } from "../src/server.ts";
import { fixtureHome } from "./helpers.ts";

async function withServer(fn: (port: number) => Promise<void>) {
  const home = await fixtureHome();
  const cli = new ClaudeCli(async () => ({ stdout: "[]", stderr: "" }));
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // The guard needs the real port, which is only known after listen().
  const port = (server.address() as AddressInfo).port;
  server.on("request", createApp({ home, cli, port, starterPrompt: "go", defaultCwd: home, pollIntervalMs: 1000, dataDir: `${home}/.ui` }));
  try {
    await fn(port);
  } finally {
    server.close();
  }
}

// fetch() forbids overriding Host, so use raw http requests.
function request(port: number, opts: { method?: string; host?: string; origin?: string; body?: string }) {
  const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${port}`, "content-type": "application/json" };
  if (opts.origin) headers.origin = opts.origin;
  return new Promise<number>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: "/api/agents", headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode!));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

test("loopback host is allowed; foreign Host (DNS rebinding) is refused", async () => {
  await withServer(async (port) => {
    assert.equal(await request(port, {}), 200);
    assert.equal(await request(port, { host: `localhost:${port}` }), 200);
    assert.equal(await request(port, { host: `evil.example:${port}` }), 403);
  });
});

test("state-changing requests need a matching or absent Origin", async () => {
  await withServer(async (port) => {
    const body = JSON.stringify({ content: "x" });
    assert.equal(await request(port, { method: "POST", origin: "http://evil.example", body }), 403);
    // Same-origin and no-origin requests reach validation (400 for bad content), so the guard let them through.
    assert.equal(await request(port, { method: "POST", origin: `http://127.0.0.1:${port}`, body }), 400);
    assert.equal(await request(port, { method: "POST", body }), 400);
  });
});

test("malformed JSON body is a 400, not a 500", async () => {
  await withServer(async (port) => {
    assert.equal(await request(port, { method: "POST", body: "{bad" }), 400);
  });
});
