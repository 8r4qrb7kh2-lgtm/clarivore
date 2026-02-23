#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_command curl
require_command git
require_command node

TARGET_REPO="${1:-$ROOT_DIR}"
TARGET_REPO="$(cd "$TARGET_REPO" && pwd)"

[[ -d "$TARGET_REPO/.git" ]] || fail "Target path is not a git repository: $TARGET_REPO"

api_base_url="http://127.0.0.1:${AXON_API_PORT}/api/v1"
wait_for_http "http://127.0.0.1:${AXON_API_PORT}/api/v1/health" 10 || fail "Axon API is not reachable. Start it first with: bash scripts/axon-mcp/up.sh"

default_branch="$(git -C "$TARGET_REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$default_branch" || "$default_branch" == "HEAD" ]]; then
  default_branch="main"
fi

repo_name="$(basename "$TARGET_REPO")"
repo_namespace_prefix="${AXON_REPO_NAMESPACE_PREFIX:-local}"
repo_namespace="${repo_namespace_prefix}/${repo_name}"

tmp_payload="$(mktemp)"
tmp_response="$(mktemp)"
tmp_list="$(mktemp)"
tmp_status="$(mktemp)"
trap 'rm -f "$tmp_payload" "$tmp_response" "$tmp_list" "$tmp_status"' EXIT

node -e '
  const fs = require("fs");
  const payload = {
    provider: "GITLAB",
    name: process.argv[2],
    path_with_namespace: process.argv[3],
    url: process.argv[4],
    clone_url: process.argv[4],
    default_branch: process.argv[5]
  };
  fs.writeFileSync(process.argv[1], JSON.stringify(payload));
' "$tmp_payload" "$repo_name" "$repo_namespace" "$TARGET_REPO" "$default_branch"

log "Registering repository with Axon: $TARGET_REPO"
create_status="$(
  curl -sS -o "$tmp_response" -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -X POST "$api_base_url/repositories" \
    --data-binary "@$tmp_payload"
)"

repo_id=""
if [[ "$create_status" == "201" || "$create_status" == "200" ]]; then
  repo_id="$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(r.id || ""));' "$tmp_response")"
  [[ -n "$repo_id" ]] || fail "Repository created but response did not include repository ID."
elif [[ "$create_status" == "409" ]]; then
  log "Repository already tracked, looking up existing ID."
  curl -sS "$api_base_url/repositories?skip=0&limit=200" >"$tmp_list"
  repo_id="$(node -e '
    const fs=require("fs");
    const namespace=process.argv[2];
    const list=JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const items=Array.isArray(list.items) ? list.items : [];
    const existing=items.find((item) => item.path_with_namespace === namespace);
    process.stdout.write(existing ? String(existing.id) : "");
  ' "$tmp_list" "$repo_namespace")"
  [[ -n "$repo_id" ]] || fail "Repository exists but could not find ID for namespace: $repo_namespace"
  curl -sS -X POST "$api_base_url/repositories/$repo_id/sync" >/dev/null
else
  fail "Repository registration failed (HTTP $create_status): $(cat "$tmp_response")"
fi

log "Tracking repository id=$repo_id; waiting for sync completion."
timeout_secs="${AXON_SYNC_TIMEOUT_SECS:-2400}"
start_ts="$(date +%s)"
last_status=""

while true; do
  curl -sS "$api_base_url/repositories/$repo_id" >"$tmp_status"
  repo_status="$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(r.status || ""));' "$tmp_status")"

  if [[ "$repo_status" != "$last_status" ]]; then
    log "Sync status: ${repo_status:-UNKNOWN}"
    last_status="$repo_status"
  fi

  if [[ "$repo_status" == "COMPLETED" ]]; then
    break
  fi
  if [[ "$repo_status" == "FAILED" ]]; then
    fail "Repository sync failed. Check logs with: npm run axon:status"
  fi
  if (( "$(date +%s)" - start_ts >= timeout_secs )); then
    fail "Timed out waiting for sync completion."
  fi
  sleep 5
done

log "Repository sync completed."
log "MCP endpoint: http://127.0.0.1:${AXON_MCP_PORT}/mcp"
