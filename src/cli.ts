#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCli, execRunner } from "./claude/claudeCli.ts";
import { ConfigError, USAGE, loadConfig, parseArgs } from "./config.ts";
import { EventBus } from "./events.ts";
import { HOST, createApp } from "./server.ts";

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

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const flags = parseArgs(argv);
  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (flags.version) {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }

  const nodeProblem = checkNodeVersion();
  if (nodeProblem) throw new ConfigError(nodeProblem);

  const config = loadConfig({ argv });
  const claudeProblem = await checkClaudeBinary(config.claudeBin);
  if (claudeProblem) throw new ConfigError(claudeProblem);

  const app = createApp({
    home: os.homedir(),
    cli: new ClaudeCli(execRunner(config.claudeBin)),
    port: config.port,
    starterPrompt: config.starterPrompt,
    defaultCwd: config.defaultCwd,
    permissionMode: config.permissionMode,
    dataDir: config.dataDir,
    historyLimit: config.historyLimit,
    events: new EventBus(),
  });

  const server = app.listen(config.port, HOST, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : config.port;
    const url = `http://${HOST}:${port}`;
    process.stdout.write(`Claude Agent UI: ${url}\n`);
    if (flags.open) openBrowser(url);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(
        `Port ${config.port} is already in use. Start it on another port: claude-agent-ui --port ${config.port + 1}\n`,
      );
    } else {
      process.stderr.write(`${err.message}\n`);
    }
    process.exitCode = 1;
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
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
