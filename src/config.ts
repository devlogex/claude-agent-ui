import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  port: number;
  starterPrompt: string;
  defaultCwd: string;
  claudeBin: string;
  pollIntervalMs: number;
}

export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

export function loadConfig(): AppConfig {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const raw = JSON.parse(readFileSync(path.join(root, "config.json"), "utf8"));
  return {
    port: Number(raw.port ?? 3000),
    starterPrompt: String(raw.starterPrompt ?? "Start your task."),
    defaultCwd: expandHome(String(raw.defaultCwd ?? "~")),
    claudeBin: String(raw.claudeBin ?? "claude"),
    pollIntervalMs: Number(raw.pollIntervalMs ?? 3000),
  };
}
