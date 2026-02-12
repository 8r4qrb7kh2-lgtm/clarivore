# Worktree Guard

deploy only from /Users/mattdavis/.cursor/worktrees/clarivore-main/9J1NT.

## Deploy Rule

- Do not run KB update/upload as part of deploy.
- Deploy web app only via `bash scripts/deploy-vercel.sh` (or `npm run deploy`, which must remain KB-free).

## Runtime Boundary

- The active web app runtime is Next.js code under `app/` (plus supporting Next config/scripts).
- `archive/` contains historical, non-runtime code snapshots only.
- Do not import, reference, or copy code from `archive/` into active runtime paths unless the user explicitly requests it.
