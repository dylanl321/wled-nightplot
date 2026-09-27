#!/bin/sh
# Process model for the Nightplot Configure image:
#   api  — Hono on NIGHTPLOT_API_HOST:NIGHTPLOT_API_PORT
#   web  — next start (rewrites /api and /health to 127.0.0.1:43181)
#   all  — both in one container
#
# Uses workspace bins, not `pnpm` — Corepack must not download at runtime.
set -eu

role="${1:-all}"
ROOT=/app
TSX="$ROOT/apps/server/node_modules/.bin/tsx"
NEXT="$ROOT/apps/web/node_modules/.bin/next"

start_api() {
  export NIGHTPLOT_API_HOST="${NIGHTPLOT_API_HOST:-0.0.0.0}"
  export NIGHTPLOT_API_PORT="${NIGHTPLOT_API_PORT:-43181}"
  export NIGHTPLOT_STORE_PATH="${NIGHTPLOT_STORE_PATH:-/data/lights.json}"
  export NIGHTPLOT_LED_PRODUCTS_PATH="${NIGHTPLOT_LED_PRODUCTS_PATH:-/data/led-products.json}"
  cd "$ROOT/apps/server"
  exec "$TSX" src/index.ts
}

start_web() {
  export NIGHTPLOT_WEB_HOST="${NIGHTPLOT_WEB_HOST:-0.0.0.0}"
  export NIGHTPLOT_WEB_PORT="${NIGHTPLOT_WEB_PORT:-43180}"
  export NIGHTPLOT_API_URL="${NIGHTPLOT_API_URL:-http://127.0.0.1:43181}"
  cd "$ROOT/apps/web"
  exec "$NEXT" start --hostname "${NIGHTPLOT_WEB_HOST}" --port "${NIGHTPLOT_WEB_PORT}"
}

start_all() {
  export NIGHTPLOT_API_HOST="${NIGHTPLOT_API_HOST:-0.0.0.0}"
  export NIGHTPLOT_API_PORT="${NIGHTPLOT_API_PORT:-43181}"
  export NIGHTPLOT_STORE_PATH="${NIGHTPLOT_STORE_PATH:-/data/lights.json}"
  export NIGHTPLOT_LED_PRODUCTS_PATH="${NIGHTPLOT_LED_PRODUCTS_PATH:-/data/led-products.json}"
  export NIGHTPLOT_WEB_HOST="${NIGHTPLOT_WEB_HOST:-0.0.0.0}"
  export NIGHTPLOT_WEB_PORT="${NIGHTPLOT_WEB_PORT:-43180}"
  export NIGHTPLOT_API_URL="${NIGHTPLOT_API_URL:-http://127.0.0.1:43181}"

  cd "$ROOT/apps/server"
  "$TSX" src/index.ts &
  api_pid=$!
  cd "$ROOT/apps/web"
  "$NEXT" start --hostname "${NIGHTPLOT_WEB_HOST}" --port "${NIGHTPLOT_WEB_PORT}" &
  web_pid=$!

  term() {
    kill "$api_pid" "$web_pid" 2>/dev/null || true
    wait "$api_pid" "$web_pid" 2>/dev/null || true
  }
  trap term INT TERM
  wait "$api_pid" "$web_pid"
}

case "$role" in
  api) start_api ;;
  web) start_web ;;
  all) start_all ;;
  *)
    echo "usage: docker-entrypoint.sh [api|web|all]" >&2
    exit 2
    ;;
esac
