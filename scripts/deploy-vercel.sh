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

vercel --prod --yes --archive=tgz
