#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

target_repo="${1:-$ROOT_DIR}"

bash "$SCRIPT_DIR/configure-ports.sh"
bash "$SCRIPT_DIR/up.sh"
bash "$SCRIPT_DIR/index-worktree.sh" "$target_repo"
bash "$SCRIPT_DIR/configure-codex-mcp.sh"
bash "$SCRIPT_DIR/configure-cursor-mcp.sh"

log "Full Axon setup complete for: $target_repo"
