# Claude Agent UI

A local web page to browse, create, edit and run Claude Code agents.

- **Agents**: global agents from `~/.claude/agents/**/*.md` (editable) and agents from enabled user-scope plugins (read-only, run as `<plugin>:<agent>`).
- **Editor**: a raw `.md` editor. Saving checks the frontmatter (`name`, `description`) and never overwrites an existing agent when creating one. Plugin agents can be copied to global.
- **Runs**: **Run** starts `claude --bg --agent <name> --dangerously-skip-permissions "<starterPrompt>"` in the chosen working directory. Each run is an isolated background session, so background subagents and background shell commands run to completion. Status comes from `claude agents --json` (`busy` → running, `idle` → finished), and the final text comes from `~/.claude/projects/*/<sessionId>.jsonl`.

## Run

```sh
npm install
npm start          # http://127.0.0.1:3000
npm run restart    # stop the running server and start it in the background (logs: ~/.claude-agent-ui/server.log)
```

The server only listens on `127.0.0.1`. Every run bypasses permission prompts, so don't expose it.

## Config (`config.json`)

| Key | Default | Meaning |
|---|---|---|
| `port` | `3000` | HTTP port (always bound to 127.0.0.1) |
| `starterPrompt` | `Start your task.` | Prompt sent to every run; agents gather their own context |
| `defaultCwd` | `~/Workspace` | Pre-filled working directory |
| `claudeBin` | `claude` | Path to the Claude Code CLI |
| `pollIntervalMs` | `3000` | Runs panel refresh while something is running |

## Notes

- `claude --bg` refuses untrusted folders. Run `claude` in that folder once and accept the trust prompt.
- A finished session stays open (idle) until you **Stop** or **Remove** it. Use **Stop all finished** to free the processes. `claude attach <id>` opens a run in your terminal.
- The run list is kept in `~/.claude-agent-ui/runs.json` (ids only), so runs survive a restart of this server.
- `claude agents --json`, the `--bg` output and the transcript format are CLI internals. Parsing lives in `src/claudeCli.ts` and `src/transcript.ts`, with fixture tests in `test/`.

## Develop

```sh
npm run typecheck
npm test
```
