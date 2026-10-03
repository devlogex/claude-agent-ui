#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCli, execRunner } from "./claude/claudeCli.ts";
import { ConfigError, USAGE, loadConfig, parseArgs } from "./config.ts";
import { HOST, createApp } from "./server.ts";
import { sweepTempFiles } from "./store/jsonStore.ts";
import { type Lock, LockError, acquireLock } from "./store/lockfile.ts";

const MIN_NODE_MAJOR = 20;

export function readVersion(): string {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try {
    return String(JSON.parse(readFileSync(file, "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

/** Returns an actionable sentence when the running Node is too old, else null. */
export function checkNodeVersion(version: string = process.version, min = MIN_NODE_MAJOR): string | null {
  const major = Number(/^v?(\d+)/.exec(version)?.[1]);
  if (!Number.isFinite(major)) return null;
  if (major >= min) return null;
  return (
    `claude-agent-ui needs Node ${min} or newer, but this is Node ${version}.\n` +
    `Install a newer Node (for example: nvm install ${min}) and run it again.`
  );
}

/** Returns an actionable sentence when the claude binary cannot be run, else null. */
export async function checkClaudeBinary(bin: string): Promise<string | null> {
  const ok = await new Promise<boolean>((resolve) => {
    execFile(bin, ["--version"], { timeout: 15_000 }, (err) => resolve(!err));
  });
  if (ok) return null;
  return (
    `Could not run the Claude Code CLI as "${bin}".\n` +
    `Install it (npm i -g @anthropic-ai/claude-code) or point at it with --claude-bin <path>\n` +
    `or CLAUDE_AGENT_UI_CLAUDE_BIN=<path>.`
  );
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  // Best effort only: failing to open a browser must never take the server down.
  execFile(cmd, args, () => {});
}

/** Turns a listen() failure into a sentence the user can act on. */
function describeListenError(err: NodeJS.ErrnoException, port: number): string {
  if (err.code === "EADDRINUSE") {
    return `Port ${port} is already in use. Start it on another port: claude-agent-ui --port ${port + 1}`;
  }
  if (err.code === "EACCES") {
    return `Port ${port} needs elevated privileges. Pick a port above 1023: claude-agent-ui --port 3000`;
  }
  return err.message;
}

/** Starts the server and resolves once it is listening; returns undefined for --help and --version. */
export async function main(argv = process.argv.slice(2)): Promise<Server | undefined> {
  const flags = parseArgs(argv);
  if (flags.help) {
    process.stdout.write(USAGE);
    return undefined;
  }
  if (flags.version) {
    process.stdout.write(`${readVersion()}\n`);
    return undefined;
  }

  const nodeProblem = checkNodeVersion();
  if (nodeProblem) throw new ConfigError(nodeProblem);

  const config = loadConfig({ argv });
  const claudeProblem = await checkClaudeBinary(config.claudeBin);
  if (claudeProblem) throw new ConfigError(claudeProblem);

  // Taken before anything reads or writes the state directory, so two servers never interleave
  // their JSON writes. LockError already reads as a sentence, so it passes through as one.
  let lock: Lock;
  try {
    lock = await acquireLock(config.dataDir);
  } catch (err) {
    throw err instanceof LockError ? new ConfigError(err.message) : err;
  }
  // Safe only while we hold the lock: any temp file still here was orphaned by an earlier crash.
  await sweepTempFiles(config.dataDir).catch(() => 0);

  // With --port 0 the OS assigns the port at listen(), so the guard reads it back rather than
  // freezing the requested 0 — otherwise it would reject the very URL we are about to print.
  let boundPort = config.port;
  const app = createApp({
    home: os.homedir(),
    cli: new ClaudeCli(execRunner(config.claudeBin)),
    port: () => boundPort,
    starterPrompt: config.starterPrompt,
    defaultCwd: config.defaultCwd,
    permissionMode: config.permissionMode,
    dataDir: config.dataDir,
    historyLimit: config.historyLimit,
  });

  const server = app.listen(config.port, HOST);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (err) {
    // The lock outlives a failed listen() otherwise, and the next run would refuse to start.
    lock.release();
    throw new ConfigError(describeListenError(err as NodeJS.ErrnoException, config.port));
  }
  // Covers every way the server goes down: close() from a test, a signal, or an unhandled throw
  // that unwinds to exit. release() is idempotent, so overlapping paths are harmless.
  server.once("close", () => lock.release());
  process.once("exit", () => lock.release());

  const address = server.address();
  boundPort = typeof address === "object" && address ? address.port : config.port;
  const url = `http://${HOST}:${boundPort}`;
  process.stdout.write(`Claude Agent UI: ${url}\n`);
  if (flags.open ?? true) openBrowser(url);

  server.on("error", (err: Error) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}

/** True when this file is the program being run — npm's bin shim is a symlink, so resolve it. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof ConfigError ? err.message : (err?.stack ?? String(err))}\n`);
    process.exit(1);
  });
}
