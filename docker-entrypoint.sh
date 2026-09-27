#!/bin/sh
# Process model for the Nightplot Configure image:
#   api  — Hono on NIGHTPLOT_API_HOST:NIGHTPLOT_API_PORT
#   web  — next start (rewrites /api and /health to hostname api)
#   all  — both in one container (needs --add-host=api:127.0.0.1)
set -eu

role="${1:-all}"

need_api_hostname() {
  if getent hosts api >/dev/null 2>&1; then
    return 0
  fi
  echo "nightplot: hostname 'api' is not resolvable." >&2
  echo "One container (all): docker run --add-host=api:127.0.0.1 …" >&2
  echo "Compose: the API service is named api (bridge DNS)." >&2
  echo "Linux Find: docker compose -f docker-compose.host.yml up --build" >&2
  return 1
}

start_api() {
  export NIGHTPLOT_API_HOST="${NIGHTPLOT_API_HOST:-0.0.0.0}"
  export NIGHTPLOT_API_PORT="${NIGHTPLOT_API_PORT:-43181}"
  export NIGHTPLOT_STORE_PATH="${NIGHTPLOT_STORE_PATH:-/data/lights.json}"
  exec pnpm --filter @nightplot/server start
}

start_web() {
  need_api_hostname
  export NIGHTPLOT_WEB_HOST="${NIGHTPLOT_WEB_HOST:-0.0.0.0}"
  export NIGHTPLOT_WEB_PORT="${NIGHTPLOT_WEB_PORT:-43180}"
  export NIGHTPLOT_API_URL="${NIGHTPLOT_API_URL:-http://api:43181}"
  exec pnpm --filter @nightplot/web start
}

start_all() {
  need_api_hostname
  export NIGHTPLOT_API_HOST="${NIGHTPLOT_API_HOST:-0.0.0.0}"
  export NIGHTPLOT_API_PORT="${NIGHTPLOT_API_PORT:-43181}"
  export NIGHTPLOT_STORE_PATH="${NIGHTPLOT_STORE_PATH:-/data/lights.json}"
  export NIGHTPLOT_WEB_HOST="${NIGHTPLOT_WEB_HOST:-0.0.0.0}"
  export NIGHTPLOT_WEB_PORT="${NIGHTPLOT_WEB_PORT:-43180}"
  export NIGHTPLOT_API_URL="${NIGHTPLOT_API_URL:-http://api:43181}"

  pnpm --filter @nightplot/server start &
  api_pid=$!
  pnpm --filter @nightplot/web start &
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
