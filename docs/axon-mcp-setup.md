# Axon MCP Setup

This repository includes local automation scripts for running [`ali-kamali/Axon.MCP.Server`](https://github.com/ali-kamali/Axon.MCP.Server) against this worktree.

Prerequisites:

- Docker (with `docker compose`)
- Git
- Node.js (for the helper scripts)

## What gets installed

- Axon source checkout in `.axon/Axon.MCP.Server` (gitignored).
- Local `.env` for Axon (generated once, then reused).
- Docker services: `postgres`, `redis`, `api`, `worker`, `mcp-server`.

Published host ports (defaults):

- Axon API: `58080`
- Axon MCP: `58001` (`/mcp` path)
- Axon Postgres: `55432`
- Axon Redis: `56379`

If one of those ports is busy, scripts automatically fall back to alternates.

## Start and index

1. Bootstrap + start Axon:
   - `npm run axon:up`
2. Register and sync this worktree:
   - `npm run axon:index`
3. Check status/logical health:
   - `npm run axon:status`
4. Stop services:
   - `npm run axon:down`

One-command full setup:

- `npm run axon:setup`
  - auto-picks/persists ports
  - starts Axon
  - indexes this worktree
  - writes Cursor MCP config

## Cursor MCP config

Add this to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "axon-clarivore": {
      "transport": "http",
      "url": "http://127.0.0.1:58001/mcp"
    }
  }
}
```

Automatic writer command:

- `npm run axon:cursor`

By default this writes to `.cursor/mcp.json`.

## Optional overrides

Set these before running scripts if you need different host ports or locations:

- `AXON_BASE_DIR`
- `AXON_DIR`
- `AXON_API_PORT`
- `AXON_MCP_PORT`
- `AXON_POSTGRES_PORT`
- `AXON_REDIS_PORT`
- `AXON_SYNC_TIMEOUT_SECS`

Persist local machine ports:

- `npm run axon:ports`
- This writes `scripts/axon-mcp/local.env` (machine-local override file).
- Starter template: `scripts/axon-mcp/local.env.example`

## Notes

- This integration is local-only and does not change app deploy behavior.
- Existing `npm run deploy` flow remains KB-free.
