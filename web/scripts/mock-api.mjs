#!/usr/bin/env node
/**
 * A stand-in for the real server, for looking at the UI.
 *
 * It speaks the same wire format as src/server.ts and src/sse.ts — the same routes, the same
 * SSE frame shape, the same event names — so the client cannot tell the difference. It exists
 * so the shell can be rendered and photographed in states the real server cannot be put into
 * on demand (an empty run list, a failing endpoint, a run starting on cue).
 *
 * All content is synthetic. No real paths, no real session ids.
 *
 *   node scripts/mock-api.mjs [--port 3000] [--scenario populated|empty|error]
 *
 * While it runs, POST /__mock/start-run pushes a run:started event; the status bar must move.
 */
import { createServer } from "node:http";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const port = Number(flag("port", 3000));
const scenario = flag("scenario", "populated");

const AGENTS = [
  {
    id: "a1",
    name: "release-notes",
    runName: "release-notes",
    description: "Drafts release notes from the commits since the last tag.",
    model: "claude-opus-5",
    source: "project",
    editable: true,
    valid: true,
    error: null,
  },
  {
    id: "a2",
    name: "flaky-test-triage",
    runName: "flaky-test-triage",
    description: "Re-runs a failing spec, bisects it and reports the first bad commit.",
    model: "claude-sonnet-5",
    source: "user",
    editable: true,
    valid: true,
    error: null,
  },
  {
    id: "a3",
    name: "dependency-audit",
    runName: "dependency-audit",
    description: "Reads the lockfile and summarises advisories that actually reach the app.",
    model: null,
    source: "user",
    editable: true,
    valid: true,
    error: null,
  },
  {
    id: "a4",
    name: "changelog-sync",
    runName: "changelog-sync",
    description: "",
    model: null,
    source: "project",
    editable: true,
    valid: false,
    error: "frontmatter is missing a `description` field",
  },
];

const now = Date.now();
const runs = [
  {
    runId: "r-7f2a91",
    agent: "release-notes",
    cwd: "/Users/sam/code/acme-web",
    status: "running",
    waiting: null,
    sessionId: "s-7f2a91",
    startedAt: now - 4 * 60_000,
    endedAt: null,
    finalText: null,
    attachCommand: "claude attach r-7f2a91",
  },
  {
    runId: "r-3c80bd",
    agent: "flaky-test-triage",
    cwd: "/Users/sam/code/acme-api",
    status: "finished",
    waiting: null,
    sessionId: "s-3c80bd",
    startedAt: now - 52 * 60_000,
    endedAt: now - 38 * 60_000,
    finalText: "Bisected to 9a1f2c4; the spec shares a fixture with the suite above it.",
    attachCommand: "claude attach r-3c80bd",
  },
  {
    runId: "r-55a0c2",
    agent: "dependency-audit",
    cwd: "/Users/sam/code/acme-api",
    status: "waiting",
    waiting: { reason: "permission", detail: "permission to run `npm audit --json`" },
    sessionId: "s-55a0c2",
    startedAt: now - 11 * 60_000,
    endedAt: null,
    finalText: null,
    attachCommand: "claude attach r-55a0c2",
  },
  {
    runId: "r-be14d7",
    agent: "dependency-audit",
    cwd: "/Users/sam/code/acme-web",
    status: "stopped",
    waiting: null,
    sessionId: "s-be14d7",
    startedAt: now - 3 * 60 * 60_000,
    endedAt: now - 3 * 60 * 60_000 + 90_000,
    finalText: null,
    attachCommand: "claude attach r-be14d7",
  },
  {
    runId: "r-02ff65",
    agent: "release-notes",
    cwd: "/Users/sam/code/acme-infra",
    status: "missing",
    waiting: null,
    sessionId: null,
    startedAt: now - 26 * 60 * 60_000,
    endedAt: null,
    finalText: null,
    attachCommand: "claude attach r-02ff65",
  },
];

let nextEventId = 1;
const clients = new Set();

function broadcast(type, data) {
  const frame = `id: ${nextEventId++}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    clients.add(res);
    res.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname === "/__mock/start-run") {
    const started = {
      runId: `r-${Math.random().toString(16).slice(2, 8)}`,
      agent: "dependency-audit",
      cwd: "/Users/sam/code/acme-infra",
      status: "running",
      waiting: null,
      sessionId: null,
      startedAt: Date.now(),
      endedAt: null,
      finalText: null,
      attachCommand: "claude attach",
    };
    runs.unshift(started);
    broadcast("run:started", { runId: started.runId });
    return json(res, 200, { ok: true, runId: started.runId });
  }

  if (scenario === "error" && url.pathname.startsWith("/api/")) {
    return json(res, 500, { error: "the run store could not be read: EACCES ~/.claude-agent-ui/runs.json" });
  }

  if (url.pathname === "/api/agents") return json(res, 200, scenario === "empty" ? [] : AGENTS);
  if (url.pathname === "/api/runs") return json(res, 200, { runs: scenario === "empty" ? [] : runs });

  return json(res, 404, { error: "not found" });
}).listen(port, "127.0.0.1", () => {
  console.log(`mock API (${scenario}) on http://127.0.0.1:${port}`);
});
