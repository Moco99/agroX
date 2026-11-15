#!/usr/bin/env bash
# Start the FastAPI backend (:8000) and the Vite frontend (:5173); Ctrl+C (or SIGTERM) stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${AGROX_API_PORT:-8000}"
WEB_PORT=5173

for bin in "$ROOT/backend/.venv/bin/uvicorn" "$ROOT/frontend/node_modules/.bin/vite"; do
  [ -x "$bin" ] || { echo "missing $bin -> run: make setup"; exit 1; }
done
for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is already in use: stop the other process first"; exit 1
  fi
done

# Each service runs in its own process group so a single kill reaches uvicorn workers and vite children
set -m
pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in ${pids[@]+"${pids[@]}"}; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  echo "agrox dev stopped"
  exit 0
}
trap cleanup INT TERM EXIT

echo "backend  -> http://127.0.0.1:$API_PORT/api/health (AGROX_DATA_MODE=${AGROX_DATA_MODE:-real})"
(cd "$ROOT/backend" && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT") &
pids+=($!)

echo "frontend -> http://127.0.0.1:$WEB_PORT"
(cd "$ROOT/frontend" && AGROX_API_URL="http://127.0.0.1:$API_PORT" exec node_modules/.bin/vite --port "$WEB_PORT" --strictPort --host 127.0.0.1) &
pids+=($!)

# Exit (and clean up the other one) as soon as either service dies; polling keeps macOS bash 3.2 compatible
while kill -0 "${pids[0]}" 2>/dev/null && kill -0 "${pids[1]}" 2>/dev/null; do
  sleep 1
done
echo "a service exited: shutting down"
