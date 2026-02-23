#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_command docker
require_command curl

bash "$SCRIPT_DIR/bootstrap.sh"

log "Starting Axon services (postgres, redis, api, worker, mcp-server)"
compose up -d postgres redis api worker mcp-server

log "Running database migrations"
attempt=0
until compose exec -T api /opt/venv/bin/python scripts/run_migrations.py >/dev/null 2>&1; do
  ((attempt += 1))
  if ((attempt >= 30)); then
    fail "Migrations failed after multiple retries. Check logs with: docker compose -f \"$AXON_COMPOSE_BASE_FILE\" -f \"$AXON_COMPOSE_OVERRIDE_FILE\" logs api"
  fi
  sleep 2
done

api_health_url="http://127.0.0.1:${AXON_API_PORT}/api/v1/health"
mcp_health_url="http://127.0.0.1:${AXON_MCP_PORT}/api/v1/health"

log "Waiting for API health: $api_health_url"
wait_for_http "$api_health_url" 240 || fail "API health check timed out"

log "Waiting for MCP health: $mcp_health_url"
wait_for_http "$mcp_health_url" 240 || fail "MCP health check timed out"

log "Axon is running."
log "API: http://127.0.0.1:${AXON_API_PORT}"
log "MCP: http://127.0.0.1:${AXON_MCP_PORT}/mcp"
log "Next: bash scripts/axon-mcp/index-worktree.sh"
