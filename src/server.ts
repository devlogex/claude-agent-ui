import express, { type NextFunction, type Request, type Response } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCli, DEFAULT_PERMISSION_MODE, type PermissionMode } from "./claude/claudeCli.ts";
import { discoverAgents, findAgent, toPublic } from "./domain/agents.ts";
import { NEW_AGENT_TEMPLATE, ValidationError, createAgent, updateAgent } from "./domain/agentStore.ts";
import { RunError, RunStore } from "./domain/runs.ts";
import { EventBus } from "./events.ts";
import { streamEvents } from "./sse.ts";

/** The only address this server ever binds. There is deliberately no option to change it. */
export const HOST = "127.0.0.1";

/**
 * The port the guard accepts in a Host header. With `--port 0` the OS picks the port at listen(),
 * so callers pass a getter and the guard reads the bound port per request instead of a stale 0.
 */
export type PortSource = number | (() => number);

/**
 * Blocks DNS rebinding: a foreign page whose hostname resolves to 127.0.0.1 would be same-origin,
 * so require our own Host header, and for state-changing requests a matching (or absent) Origin.
 */
export function loopbackGuard(port: PortSource) {
  const allowed = (host: string, bound: number) =>
    host === `127.0.0.1:${bound}` || host === `localhost:${bound}` || host === `[::1]:${bound}`;
  return (req: Request, res: Response, next: NextFunction) => {
    const bound = typeof port === "function" ? port() : port;
    const host = req.headers.host ?? "";
    const origin = req.headers.origin;
    const safeMethod = req.method === "GET" || req.method === "HEAD";
    if (!allowed(host, bound) || (!safeMethod && origin !== undefined && origin !== `http://${host}`)) {
      res.status(403).json({ error: "forbidden host or origin" });
      return;
    }
    next();
  };
}

export interface AppOptions {
  home: string;
  cli: ClaudeCli;
  /** A number, or a getter when the bound port is only known after listen() — see {@link PortSource}. */
  port: PortSource;
  starterPrompt: string;
  defaultCwd: string;
  permissionMode?: PermissionMode;
  dataDir?: string;
  historyLimit?: number;
  /** Directory holding the built web client; defaults to `web/` next to this module. */
  webRoot?: string;
  /** The bus /api/events streams; one is created when the caller does not supply it. */
  bus?: EventBus;
}

export function createApp(opts: AppOptions) {
  const { home } = opts;
  const permissionMode = opts.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const bus = opts.bus ?? new EventBus();
  const runs = new RunStore(home, opts.cli, opts.starterPrompt, {
    dataDir: opts.dataDir,
    historyLimit: opts.historyLimit,
    bus,
  });
  const webRoot = opts.webRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

  const app = express();
  // Published so later subsystems (the task queue, the scheduler) emit onto the same bus.
  app.locals.bus = bus;
  // Shutdown needs these: server.close() waits for open connections, and an SSE connection never
  // ends on its own, so something has to end them. See closeStreams below.
  const streams = new Set<() => void>();
  app.locals.closeStreams = () => {
    for (const close of [...streams]) close();
  };
  app.use(loopbackGuard(opts.port));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(webRoot));

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  app.get("/api/config", (_req, res) => {
    res.json({
      defaultCwd: opts.defaultCwd,
      starterPrompt: opts.starterPrompt,
      permissionMode,
      template: NEW_AGENT_TEMPLATE,
    });
  });

  // The only push channel in the product: nothing here polls. The response is owned by
  // streamEvents from this point on, so the handler must not touch res afterwards.
  app.get("/api/events", (req, res) => {
    const close = streamEvents(bus, req, res);
    streams.add(close);
    res.on("close", () => streams.delete(close));
  });

  app.get(
    "/api/agents",
    wrap(async (_req, res) => {
      res.json((await discoverAgents(home)).map(toPublic));
    }),
  );

  app.get(
    "/api/agents/:id",
    wrap(async (req, res) => {
      const agent = await findAgent(home, String(req.params.id));
      if (!agent) throw new ValidationError("agent not found", 404);
      res.json({ ...toPublic(agent), content: await readFile(agent.filePath, "utf8") });
    }),
  );

  app.post(
    "/api/agents",
    wrap(async (req, res) => {
      await createAgent(home, req.body?.content);
      res.status(201).json({ ok: true });
    }),
  );

  app.put(
    "/api/agents/:id",
    wrap(async (req, res) => {
      await updateAgent(home, String(req.params.id), req.body?.content);
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/runs",
    wrap(async (_req, res) => {
      res.json(await runs.list());
    }),
  );

  app.post(
    "/api/runs",
    wrap(async (req, res) => {
      const agentId = String(req.body?.agentId ?? "");
      const agent = await findAgent(home, agentId);
      if (!agent) throw new RunError("agent not found", 404);
      if (!agent.valid) throw new RunError("agent file has invalid frontmatter; fix it before running");
      const run = await runs.start(agent.runName, String(req.body?.cwd ?? ""), {
        prompt: req.body?.prompt,
        unattended: req.body?.unattended,
        permissionMode: req.body?.permissionMode ?? permissionMode,
      });
      res.status(201).json(run);
    }),
  );

  app.post(
    "/api/runs/stop-finished",
    wrap(async (_req, res) => {
      res.json({ stopped: await runs.stopFinished() });
    }),
  );

  app.post(
    "/api/runs/:id/stop",
    wrap(async (req, res) => {
      await runs.stop(String(req.params.id));
      res.json({ ok: true });
    }),
  );

  app.delete(
    "/api/runs/:id",
    wrap(async (req, res) => {
      await runs.remove(String(req.params.id));
      res.json({ ok: true });
    }),
  );

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const raw =
      err instanceof ValidationError || err instanceof RunError
        ? err.status
        : ((err as any).status ?? (err as any).statusCode);
    const status = Number.isInteger(raw) && raw >= 400 && raw < 600 ? raw : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message });
  });

  return app;
}
