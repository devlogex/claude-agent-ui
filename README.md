# claude-agent-ui

A local web UI to browse, edit, schedule and run your Claude Code agents as background sessions.

```sh
npx claude-agent-ui
```

It opens <http://127.0.0.1:3000> in your browser; pass `--no-open` if you would rather it did not.

## Requirements

- Node 20 or newer
- The Claude Code CLI on your `PATH` as `claude` (or point at it with `--claude-bin`)

## Options

```
--port <n>              Port to listen on (default 3000)
--data-dir <path>       State directory (default ~/.claude-agent-ui)
--config <path>         Config file (default <data-dir>/config.json)
--cwd <path>            Default working directory for new runs
--claude-bin <path>     Path to the claude binary
--starter-prompt <text> Prompt used when a run is started with no prompt
--concurrency <n>       Tasks run at once (default 2)
--max-attempts <n>      Attempts per task, 1 = retries off (default 1)
--history-limit <n>     Stored history entries (default 500)
--permission-mode <m>   "ask" (default) or "bypassPermissions"
--no-open               Do not open the UI in your browser (it opens by default)
-h, --help              Show this help
-v, --version           Show the version
```

Every option can also be set in `~/.claude-agent-ui/config.json` or through a
`CLAUDE_AGENT_UI_*` environment variable. Flags beat environment variables, which beat the
config file.

## Defaults worth knowing

- **Runs ask for permission.** `--dangerously-skip-permissions` is passed only when you choose
  `bypassPermissions` for that run. It is never the default.
- **Loopback only.** The server binds `127.0.0.1` and there is no option to change that. Every
  route is behind a guard that checks `Host` and `Origin`, so a web page cannot reach it by
  resolving a hostname to `127.0.0.1`.
- **No telemetry.** Nothing is sent anywhere. The only processes it starts are your `claude`
  binary and, once at startup unless you pass `--no-open`, your browser.
- **State is yours.** Everything lives in `~/.claude-agent-ui/` as plain JSON, written
  atomically. One server at a time holds that directory: a second one exits and tells you which
  PID has it, so two copies can never interleave their writes.
- **Nothing polls.** The UI gets one `GET /api/events` server-sent-event stream and re-reads what
  changed. It reconnects with `Last-Event-ID`, and a client that stops reading is dropped rather
  than buffered.

## Development

The server and the React client are separate npm projects, so both need installing.

```sh
npm install
npm run web:install

npm test           # server, node:test — no claude binary required
npm run web:test   # client, vitest
npm run typecheck
npm run build      # tsup → dist/, then vite → dist/web, in that order
npm start          # runs the CLI from source
npm run dev        # same, restarting on a change
npm run web:dev    # the client with HMR, proxying /api to the server above
```

`npm run test:smoke` is the one that matters before a release: it packs the tarball, installs it
into an empty directory and walks all four screens in a real browser, so it catches what a test
importing from `src/` cannot. It needs a browser — `npx playwright install chromium`, or it
falls back to an installed Google Chrome.

The build order is not interchangeable. `tsup` cleans `dist/` first; running `vite` before it
would delete the client that was just built.

## Licence

MIT
