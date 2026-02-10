# Next.js Transition Status

## What is now Next-first
- Web app routes are provided by the Next app router (`/app/*`).
- Internal auth and navigation redirects now use Next routes on web.
- Vercel config is Next-first (`vercel.json`).
- Capacitor now uses Next export output (`webDir: "out"`).
- `cap:copy` and `cap:sync` now build Next before copying/syncing.

## Simplifications completed
- Shared route fallback UI extracted to `app/components/RouteSuspense.js`.
- Shared "last confirmed" formatting extracted to `app/lib/confirmationAge.js`.
- Duplicate Supabase client bootstraps removed in key pages.
- Hardcoded Supabase credentials removed from `api/ai-proxy.js` in favor of env vars.
- `report-issue`, `my-dishes`, `order-feedback`, `kitchen-tablet`, `server-tablet`, and `admin-dashboard` no longer depend on legacy `/js/shared-nav.js`.

## Current migration inventory
- Legacy static HTML pages still present in `public/`: 15
- Legacy runtime JS files in `public/js/`: 109
- Next clients still booting legacy runtime modules via `/js/*`: 16 imports

## Remaining high-priority work
1. Migrate the `restaurant` runtime (`/public/js/restaurant*`) into app-local modules.
2. Remove remaining shared-nav dependency from `manager-dashboard` and `help-contact`.
3. Migrate remaining legacy page runtimes into app-local code and remove `webpackIgnore` imports.
4. Retire `public/*.html` legacy pages after parity and replace with compatibility redirects only if still needed.

## Validation commands
- `npm run build`
- `npm run cap:copy`
