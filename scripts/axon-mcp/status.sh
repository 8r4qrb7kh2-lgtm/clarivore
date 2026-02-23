#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_command curl
require_command node
require_command docker

api_health_url="http://127.0.0.1:${AXON_API_PORT}/api/v1/health"
mcp_health_url="http://127.0.0.1:${AXON_MCP_PORT}/api/v1/health"
api_base_url="http://127.0.0.1:${AXON_API_PORT}/api/v1"

log "Ports: API=$AXON_API_PORT MCP=$AXON_MCP_PORT POSTGRES=$AXON_POSTGRES_PORT REDIS=$AXON_REDIS_PORT"

if curl -fsS "$api_health_url" >/dev/null 2>&1; then
  log "API healthy at $api_health_url"
else
  log "API not reachable at $api_health_url"
fi

if curl -fsS "$mcp_health_url" >/dev/null 2>&1; then
  log "MCP healthy at $mcp_health_url"
else
  log "MCP not reachable at $mcp_health_url"
fi

tmp_list="$(mktemp)"
trap 'rm -f "$tmp_list"' EXIT

if curl -fsS "$api_base_url/repositories?skip=0&limit=200" >"$tmp_list" 2>/dev/null; then
  node -e '
    const fs=require("fs");
    const payload=JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const items=Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      console.log("[axon-mcp] No tracked repositories yet.");
      process.exit(0);
    }
    console.log("[axon-mcp] Tracked repositories:");
    for (const item of items) {
      console.log(`[axon-mcp] - #${item.id} ${item.path_with_namespace} (${item.status})`);
    }
  ' "$tmp_list"
else
  log "Could not fetch repository list from API."
fi

log "Compose services:"
compose ps
