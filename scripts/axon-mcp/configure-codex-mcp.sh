#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

server_name="${AXON_CODEX_MCP_SERVER_NAME:-axon-clarivore}"
server_url="http://127.0.0.1:${AXON_MCP_PORT}/mcp"

if ! command -v codex >/dev/null 2>&1; then
  log "Codex CLI not found; skipping Codex MCP configuration."
  exit 0
fi

current_url="$(codex mcp get "$server_name" 2>/dev/null | awk -F': ' '/^  url: / {print $2}')"

if [[ "$current_url" == "$server_url" ]]; then
  log "Codex MCP server '$server_name' already configured: $server_url"
  exit 0
fi

if codex mcp get "$server_name" >/dev/null 2>&1; then
  codex mcp remove "$server_name" >/dev/null
fi

codex mcp add "$server_name" --url "$server_url" >/dev/null

log "Configured Codex MCP server: $server_name"
log "Server '$server_name' -> $server_url"
