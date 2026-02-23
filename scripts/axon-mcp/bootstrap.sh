#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_command git

mkdir -p "$AXON_BASE_DIR"

if [[ -d "$AXON_DIR/.git" ]]; then
  log "Updating Axon checkout in $AXON_DIR"
  git -C "$AXON_DIR" fetch origin "$AXON_BRANCH" --depth 1
  git -C "$AXON_DIR" checkout "$AXON_BRANCH"
  git -C "$AXON_DIR" reset --hard "origin/$AXON_BRANCH"
else
  log "Cloning Axon.MCP.Server into $AXON_DIR"
  git clone --depth 1 --branch "$AXON_BRANCH" "$AXON_REPO_URL" "$AXON_DIR"
fi

if [[ ! -f "$AXON_ENV_FILE" ]]; then
  log "Creating Axon env file: $AXON_ENV_FILE"

  api_secret="$(generate_secret 32)"
  jwt_secret="$(generate_secret 64)"
  admin_api_key="$(generate_secret 24)"
  redis_password="$(generate_secret 12)"
  postgres_password="$(generate_secret 12)"

  cat >"$AXON_ENV_FILE" <<EOF
APP_NAME=Axon.MCP.Server
APP_VERSION=1.0.0
DEBUG=false
ENVIRONMENT=development

GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=local-placeholder-token
GITLAB_GROUP_ID=

AZUREDEVOPS_URL=https://dev.azure.com
AZUREDEVOPS_USERNAME=
AZUREDEVOPS_PASSWORD=
AZUREDEVOPS_PROJECT=
AZUREDEVOPS_USE_NTLM=false
AZUREDEVOPS_SSL_VERIFY=true

POSTGRES_USER=axon
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=axon_mcp
DATABASE_URL=postgresql://axon:$postgres_password@postgres:5432/axon_mcp

REDIS_PASSWORD=$redis_password
REDIS_URL=redis://:$redis_password@redis:6379/0
CELERY_BROKER_URL=redis://:$redis_password@redis:6379/0
CELERY_RESULT_BACKEND=redis://:$redis_password@redis:6379/0

EMBEDDING_PROVIDER=local
LOCAL_EMBEDDING_MODEL=sentence-transformers/all-mpnet-base-v2
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
LLM_MODEL=gpt-oss:120b

MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=8001
MCP_HTTP_PATH=/mcp

API_HOST=0.0.0.0
API_PORT=8080
API_WORKERS=2
API_SECRET_KEY=$api_secret
API_CORS_ORIGINS=["*"]
API_RATE_LIMIT=500

AUTH_ENABLED=false
ADMIN_API_KEY=$admin_api_key
ADMIN_PASSWORD=local-admin
READ_ONLY_API_KEYS=[]
MCP_AUTH_ENABLED=false
JWT_ALGORITHM=HS256
JWT_SECRET_KEY=$jwt_secret
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=120
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

REPO_CACHE_DIR=./cache/repos
REPO_MAX_SIZE_MB=2000
REPO_CLEANUP_DAYS=14
PARSE_TIMEOUT_SECONDS=600
PARSE_MAX_FILE_SIZE_MB=15

LOG_LEVEL=INFO
LOG_FORMAT=json
METRICS_ENABLED=false
TRACING_ENABLED=false
EOF
else
  log "Using existing Axon env file: $AXON_ENV_FILE"
fi

log "Bootstrap complete."
log "Next: bash scripts/axon-mcp/up.sh"
