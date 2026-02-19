#!/usr/bin/env bash
set -euo pipefail

if [ -f ".git" ]; then
  mv .git .git.worktree
  cleanup() {
    if [ -f .git.worktree ]; then
      mv .git.worktree .git
    fi
  }
  trap cleanup EXIT
fi

PRIMARY_DOMAIN="${VERCEL_PRIMARY_DOMAIN:-clarivore.org}"
DOMAIN_SCOPE="${VERCEL_DOMAIN_SCOPE:-}"

deploy_url="$(vercel --prod --yes --archive=tgz)"
deploy_host="$(printf '%s' "$deploy_url" | sed -E 's#^https?://##; s#/.*$##')"

if [ -z "$deploy_host" ]; then
  echo "Failed to parse Vercel deployment URL: $deploy_url" >&2
  exit 1
fi

echo "Production deployment: $deploy_url"

alias_cmd=(vercel alias set "$deploy_host" "$PRIMARY_DOMAIN")
if [ -n "$DOMAIN_SCOPE" ]; then
  alias_cmd+=(--scope "$DOMAIN_SCOPE")
fi

alias_output=""
if ! alias_output="$("${alias_cmd[@]}" 2>&1)"; then
  if printf '%s' "$alias_output" | grep -Eiq "already assigned|already in use by this deployment|already points"; then
    echo "$alias_output"
  else
    echo "Domain alias step failed for $PRIMARY_DOMAIN." >&2
    if [ -n "$DOMAIN_SCOPE" ]; then
      echo "Attempted scope: $DOMAIN_SCOPE" >&2
    fi
    echo "Set VERCEL_DOMAIN_SCOPE to the team that owns the domain, or add the domain to this project scope." >&2
    echo "$alias_output" >&2
    exit 1
  fi
else
  echo "$alias_output"
fi
