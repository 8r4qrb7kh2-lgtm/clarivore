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
AXON_LOCAL_ENV_FILE="${AXON_LOCAL_ENV_FILE:-$ROOT_DIR/scripts/axon-mcp/local.env}"

if [[ -f "$AXON_LOCAL_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$AXON_LOCAL_ENV_FILE"
fi

# Host-side ports used by the local Axon stack.
AXON_API_PORT="${AXON_API_PORT:-58080}"
AXON_MCP_PORT="${AXON_MCP_PORT:-58001}"
AXON_POSTGRES_PORT="${AXON_POSTGRES_PORT:-55432}"
AXON_REDIS_PORT="${AXON_REDIS_PORT:-56379}"
AXON_API_PORT_CANDIDATES="${AXON_API_PORT_CANDIDATES:-58080 59080 60080 61080}"
AXON_MCP_PORT_CANDIDATES="${AXON_MCP_PORT_CANDIDATES:-58001 59001 60001 61001}"
AXON_POSTGRES_PORT_CANDIDATES="${AXON_POSTGRES_PORT_CANDIDATES:-55432 56432 57432 58432}"
AXON_REDIS_PORT_CANDIDATES="${AXON_REDIS_PORT_CANDIDATES:-56379 57379 58379 59379}"

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

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" | tail -n +2 | grep -q .
    return
  fi
  (echo >"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

select_available_port() {
  local preferred="$1"
  shift

  if ! port_in_use "$preferred"; then
    printf '%s' "$preferred"
    return 0
  fi

  local candidate
  for candidate in "$@"; do
    [[ -z "$candidate" || "$candidate" == "$preferred" ]] && continue
    if ! port_in_use "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  fail "No available port found for preferred port $preferred."
}

resolve_port() {
  local label="$1"
  local preferred="$2"
  shift 2
  local chosen
  chosen="$(select_available_port "$preferred" "$@")"
  if [[ "$chosen" != "$preferred" ]]; then
    printf '%s\n' "[axon-mcp] $label port $preferred is busy; using $chosen." >&2
  fi
  printf '%s' "$chosen"
}

if [[ "${AXON_DISABLE_PORT_AUTOSELECT:-0}" != "1" ]]; then
  IFS=' ' read -r -a _axon_api_candidates <<<"$AXON_API_PORT_CANDIDATES"
  IFS=' ' read -r -a _axon_mcp_candidates <<<"$AXON_MCP_PORT_CANDIDATES"
  IFS=' ' read -r -a _axon_pg_candidates <<<"$AXON_POSTGRES_PORT_CANDIDATES"
  IFS=' ' read -r -a _axon_redis_candidates <<<"$AXON_REDIS_PORT_CANDIDATES"

  AXON_API_PORT="$(resolve_port "API" "$AXON_API_PORT" "${_axon_api_candidates[@]}")"
  AXON_MCP_PORT="$(resolve_port "MCP" "$AXON_MCP_PORT" "${_axon_mcp_candidates[@]}")"
  AXON_POSTGRES_PORT="$(resolve_port "Postgres" "$AXON_POSTGRES_PORT" "${_axon_pg_candidates[@]}")"
  AXON_REDIS_PORT="$(resolve_port "Redis" "$AXON_REDIS_PORT" "${_axon_redis_candidates[@]}")"
fi

compose() {
  [[ -d "$AXON_DIR" ]] || fail "Axon directory not found: $AXON_DIR"
  [[ -f "$AXON_COMPOSE_BASE_FILE" ]] || fail "Compose file not found: $AXON_COMPOSE_BASE_FILE"
  [[ -f "$AXON_COMPOSE_OVERRIDE_FILE" ]] || fail "Compose override file not found: $AXON_COMPOSE_OVERRIDE_FILE"
  [[ -f "$AXON_ENV_FILE" ]] || fail "Axon env file not found: $AXON_ENV_FILE"

  (
    cd "$AXON_DIR"
    AXON_API_PORT="$AXON_API_PORT" \
    AXON_MCP_PORT="$AXON_MCP_PORT" \
    AXON_POSTGRES_PORT="$AXON_POSTGRES_PORT" \
    AXON_REDIS_PORT="$AXON_REDIS_PORT" \
    docker compose \
      --env-file "$AXON_ENV_FILE" \
      -f "$AXON_COMPOSE_BASE_FILE" \
      -f "$AXON_COMPOSE_OVERRIDE_FILE" \
      "$@"
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
