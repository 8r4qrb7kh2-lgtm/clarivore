# Legacy Editor Parity Report

- Run ID: `legacy-parity-20260218004136`
- Base URL: `http://127.0.0.1:8081`
- Slug: `demo-menu`
- Verdict: **FAIL**
- Started: 2026-02-18T00:41:36.296Z
- Finished: 2026-02-18T00:42:00.420Z

## Checks

- PASSED: Manager sign in (1211ms)
- FAILED: Load legacy parity editor (22037ms)
  - Error: locator.waitFor: Timeout 20000ms exceeded.
Call log:
  - waiting for getByRole('heading', { name: 'Webpage editor' }).first() to be visible

- FAILED: Unhandled failure (undefinedms)
  - Error: locator.waitFor: Timeout 20000ms exceeded.
Call log:
  - waiting for getByRole('heading', { name: 'Webpage editor' }).first() to be visible


## Screenshots

- none (set VERIFY_CAPTURE_SNAPSHOTS=1 or --capture=1)

