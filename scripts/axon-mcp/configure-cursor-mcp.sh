#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_command node

target_file="${1:-${AXON_CURSOR_MCP_FILE:-$ROOT_DIR/.cursor/mcp.json}}"
server_name="${AXON_MCP_SERVER_NAME:-axon-clarivore}"
server_url="http://127.0.0.1:${AXON_MCP_PORT}/mcp"

node - "$target_file" "$server_name" "$server_url" <<'NODE'
const fs = require("fs");
const path = require("path");

const targetFile = process.argv[2];
const serverName = process.argv[3];
const serverUrl = process.argv[4];

let config = {};
if (fs.existsSync(targetFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(targetFile, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed;
    }
  } catch {
    config = {};
  }
}

if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
  config.mcpServers = {};
}

config.mcpServers[serverName] = {
  transport: "http",
  url: serverUrl,
};

fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, `${JSON.stringify(config, null, 2)}\n`);
NODE

log "Wrote Cursor MCP config: $target_file"
log "Server '$server_name' -> $server_url"
