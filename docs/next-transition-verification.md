# Next Transition Verification Harness

This repository includes a reusable full-stack sign-off harness for validating the Next-framework transition end-to-end on staging.

- Entrypoint: `scripts/verify-next-transition.mjs`
- NPM command: `npm run verify:next-transition`
- Reports:
  - `docs/parity-snapshots/reports/next-transition-<RUN_ID>.json`
  - `docs/parity-snapshots/reports/next-transition-<RUN_ID>.md`

## Scope

The harness validates all of the following in a single run:

1. Structural migration checks
- Removed runtime/decommissioned file paths are absent.
- Forbidden legacy runtime identifiers are absent from active code.
- Required App Router route files exist.
- `next.config.js` does not use `output: "export"` and legacy `.html` redirects exist.

2. Build and preview smoke checks
- Production build succeeds (`npm run build`).
- Preview server starts (`next start -p 8081`).
- Route matrix responds successfully across all user surfaces.
- Legacy `.html` redirects resolve correctly.
- API route contract checks for invalid/method-rejected requests.

3. Authenticated browser checks (Playwright)
- Anonymous access restrictions for manager/admin routes.
- Admin sign-in and dashboard checks.
- Create temporary restaurant and generate invite link.
- Manager sign-in via invite flow, editor save, order submit, chat message.
- Diner sign-in, viewer/order flow, favorite toggle roundtrip.

4. Deterministic cleanup
- Removes test artifacts from staging data.
- Restores temporary overlay mutation before row removal.
- Verifies no residual `RUN_ID` artifacts remain.

5. Capacitor verification
- Runs `npm run cap:copy` using staging `CAPACITOR_SERVER_URL`.
- Verifies iOS copied assets and capacitor config URL.
- Enforces git-delta guard against non-Capacitor unexpected changes.

## Required Environment Variables

Set all of these before running:

- `TARGET_ENV=staging`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL` (staging PostgreSQL URL)
- `QA_ADMIN_EMAIL`
- `QA_ADMIN_PASSWORD`
- `QA_MANAGER_EMAIL`
- `QA_MANAGER_PASSWORD`
- `QA_DINER_EMAIL`
- `QA_DINER_PASSWORD`
- `CAPACITOR_SERVER_URL` (staging app URL)

Optional:

- `VERIFY_BASE_URL` (default: `http://127.0.0.1:8081`)
- `VERIFY_RUN_ID` (default generated as `next-transition-<timestamp>`)
- `VERIFY_CAPTURE_SNAPSHOTS=1` to store a screenshot under `docs/parity-snapshots`.

## Usage

```bash
export TARGET_ENV=staging
export NEXT_PUBLIC_SUPABASE_URL=...
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export DATABASE_URL=...
export QA_ADMIN_EMAIL=...
export QA_ADMIN_PASSWORD=...
export QA_MANAGER_EMAIL=...
export QA_MANAGER_PASSWORD=...
export QA_DINER_EMAIL=...
export QA_DINER_PASSWORD=...
export CAPACITOR_SERVER_URL=https://staging.example.com

npm run verify:next-transition
```

## Local Prerequisites

- `rg` available in `PATH`
- `psql` available in `PATH`
- `npm`/`npx` available in `PATH`
- Chromium runtime installable by Playwright (`npx playwright install chromium`)

## Exit Behavior

- Prints exactly one final verdict line: `PASS` or `FAIL`.
- Returns exit code `0` on full success.
- Returns non-zero exit code on any failed required stage.

## Notes

- The harness is guarded to run from this worktree root:
  - `/Users/mattdavis/.cursor/worktrees/clarivore-main/9J1NT`
- Existing local dirty git state is tolerated.
- Git delta validation compares against baseline status captured at run start.
