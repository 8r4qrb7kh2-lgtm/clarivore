#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_command docker

if [[ ! -d "$AXON_DIR" ]]; then
  log "No Axon checkout found at $AXON_DIR; nothing to stop."
  exit 0
fi

log "Stopping Axon services"
compose down --remove-orphans
log "Axon services stopped."
