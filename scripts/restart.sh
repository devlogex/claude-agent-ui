#!/usr/bin/env bash
# Stop the running Claude Agent UI server (if any) and start it again in the background.
# Usage: npm run restart        (logs: ~/.claude-agent-ui/server.log)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).port ?? 4317))' "$ROOT/config.json")"
LOG_DIR="$HOME/.claude-agent-ui"
LOG="$LOG_DIR/server.log"

# Only stop a listener that is this project's server, never an unrelated process on the port.
for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  cmd="$(ps -o command= -p "$pid" || true)"
  cwd="$(lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [[ "$cmd" != *"src/server.ts"* || "$cwd" != "$ROOT" ]]; then
    echo "Port $PORT is used by another process (pid $pid: $cmd); not stopping it." >&2
    exit 1
  fi
  # Also stop the npm/tsx wrappers above it so no orphan parent is left behind.
  targets="$pid"
  parent="$(ps -o ppid= -p "$pid" | tr -d ' ')"
  while [[ -n "$parent" && "$parent" != 1 ]] && ps -o command= -p "$parent" | grep -qE "tsx|npm"; do
    targets="$targets $parent"
    parent="$(ps -o ppid= -p "$parent" | tr -d ' ')"
  done
  echo "Stopping server (pids $targets)"
  kill $targets 2>/dev/null || true
done

for _ in $(seq 1 10); do
  lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 0.5
done
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Server did not stop; port $PORT is still in use." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
cd "$ROOT"
nohup npm start >>"$LOG" 2>&1 </dev/null &
disown

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/config" 2>/dev/null; then
    echo "Server running: http://127.0.0.1:$PORT (logs: $LOG)"
    exit 0
  fi
  sleep 0.5
done
echo "Server did not come up within 15s; see $LOG" >&2
tail -n 20 "$LOG" >&2
exit 1
