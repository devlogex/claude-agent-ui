import { execFile } from "node:child_process";

export class CliError extends Error {
  constructor(message: string, readonly output: string) {
    super(message);
  }
}

export interface CliResult {
  stdout: string;
  stderr: string;
}

/** Runs the claude binary with an argument array (never through a shell). */
export type CliRunner = (args: string[], opts?: { cwd?: string; timeoutMs?: number }) => Promise<CliResult>;

export function execRunner(bin: string): CliRunner {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        bin,
        args,
        { cwd: opts.cwd, timeout: opts.timeoutMs ?? 30_000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const output = `${stdout}\n${stderr}`.trim();
            reject(new CliError(output || err.message, output));
          } else {
            resolve({ stdout, stderr });
          }
        },
      );
    });
}

export interface BackgroundSession {
  id: string;
  sessionId: string;
  pid?: number;
  cwd: string;
  kind: string;
  name?: string;
  status?: string;
  state?: string;
  startedAt?: number;
}

const BG_ID = /backgrounded\s*·\s*([0-9a-f]+)/;

export function parseBgOutput(text: string): string {
  const match = BG_ID.exec(text);
  if (!match) throw new CliError(text.trim() || "claude --bg printed no session id", text);
  return match[1];
}

export function parseSessions(json: string): BackgroundSession[] {
  const data = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error("claude agents --json did not return an array");
  return data.filter((s) => s && typeof s.sessionId === "string");
}

export const UNATTENDED_PROMPT =
  "You are running unattended in a background session: no human is watching and nobody can answer questions. " +
  "Never ask the user anything or wait for input, and tell any subagent or skill you run the same. " +
  "Decide minor or conventional choices yourself and record them in your final report. " +
  "If a major question you cannot resolve from the available context blocks the work, stop and end the session with a final message " +
  "that starts with \"BLOCKED:\" and states the question, what you checked, and what you need from the user.";

export class ClaudeCli {
  constructor(private readonly run: CliRunner) {}

  async startBackground(opts: { agent: string; cwd: string; prompt: string; unattended?: boolean }): Promise<string> {
    const args = ["--bg", "--agent", opts.agent, "--dangerously-skip-permissions"];
    // Nobody watches a background run, so a question would hang it forever: remove the tool and say what to do instead.
    if (opts.unattended) args.push("--disallowedTools=AskUserQuestion", "--append-system-prompt", UNATTENDED_PROMPT);
    // "--" ends option parsing so a prompt starting with "-" is never read as a flag.
    args.push("--", opts.prompt);
    let out: CliResult;
    try {
      out = await this.run(args, { cwd: opts.cwd, timeoutMs: 60_000 });
    } catch (err) {
      if (err instanceof CliError) throw new CliError(stripAnsi(err.message), err.output);
      throw err;
    }
    return parseBgOutput(stripAnsi(`${out.stdout}\n${out.stderr}`));
  }

  /** Includes stopped sessions (`--all`) so the UI can show them as stopped rather than missing. */
  async listSessions(): Promise<BackgroundSession[]> {
    const { stdout } = await this.run(["agents", "--json", "--all"]);
    return parseSessions(stdout);
  }

  async stop(shortId: string): Promise<void> {
    await this.run(["stop", shortId]);
  }

  async remove(shortId: string): Promise<void> {
    await this.run(["rm", shortId]);
  }
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
