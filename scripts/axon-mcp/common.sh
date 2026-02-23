#!/usr/bin/env bash
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "This script is intended to be sourced, not executed directly." >&2
  exit 1
fi

if [[ -n "${AXON_COMMON_SH_LOADED:-}" ]]; then
  return 0
fi
AXON_COMMON_SH_LOADED=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AXON_BASE_DIR="${AXON_BASE_DIR:-$ROOT_DIR/.axon}"
AXON_DIR="${AXON_DIR:-$AXON_BASE_DIR/Axon.MCP.Server}"
AXON_REPO_URL="${AXON_REPO_URL:-https://github.com/ali-kamali/Axon.MCP.Server.git}"
AXON_BRANCH="${AXON_BRANCH:-public-release}"
AXON_ENV_FILE="${AXON_ENV_FILE:-$AXON_DIR/.env}"

# Host-side ports used by the local Axon stack.
AXON_API_PORT="${AXON_API_PORT:-58080}"
AXON_MCP_PORT="${AXON_MCP_PORT:-58001}"
AXON_POSTGRES_PORT="${AXON_POSTGRES_PORT:-55432}"
AXON_REDIS_PORT="${AXON_REDIS_PORT:-56379}"

AXON_COMPOSE_BASE_FILE="${AXON_COMPOSE_BASE_FILE:-$AXON_DIR/docker/docker-compose.yml}"
AXON_COMPOSE_OVERRIDE_FILE="${AXON_COMPOSE_OVERRIDE_FILE:-$ROOT_DIR/scripts/axon-mcp/docker-compose.override.yml}"

log() {
  printf '%s\n' "[axon-mcp] $*"
}

fail() {
  printf '%s\n' "[axon-mcp] ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

generate_secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
    return
  fi
  od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
}

compose() {
  [[ -d "$AXON_DIR" ]] || fail "Axon directory not found: $AXON_DIR"
  [[ -f "$AXON_COMPOSE_BASE_FILE" ]] || fail "Compose file not found: $AXON_COMPOSE_BASE_FILE"
  [[ -f "$AXON_COMPOSE_OVERRIDE_FILE" ]] || fail "Compose override file not found: $AXON_COMPOSE_OVERRIDE_FILE"

  (
    cd "$AXON_DIR"
    AXON_API_PORT="$AXON_API_PORT" \
    AXON_MCP_PORT="$AXON_MCP_PORT" \
    AXON_POSTGRES_PORT="$AXON_POSTGRES_PORT" \
    AXON_REDIS_PORT="$AXON_REDIS_PORT" \
    docker compose -f "$AXON_COMPOSE_BASE_FILE" -f "$AXON_COMPOSE_OVERRIDE_FILE" "$@"
  )
}

wait_for_http() {
  local url="$1"
  local timeout_secs="${2:-180}"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - start_ts >= timeout_secs )); then
      return 1
    fi
    sleep 2
  done
}
