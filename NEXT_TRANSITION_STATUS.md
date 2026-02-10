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
- `report-issue`, `my-dishes`, `order-feedback`, `kitchen-tablet`, `server-tablet`, `admin-dashboard`, `manager-dashboard`, and `help-contact` no longer depend on legacy `/js/shared-nav.js`.
- App-level `shared-nav` imports are now fully removed.
- `restaurant`, `manager-dashboard`, and `admin-dashboard` runtime entry points are now app-local modules (`app/**/runtime/legacy/*`) instead of `/public/js/*` URL imports.
- App-level `webpackIgnore` imports are fully removed.
- Shared notification/allergen helpers moved into app modules:
  - `app/lib/orderNotifications.js`
  - `app/lib/managerNotifications.js`
  - `app/lib/allergenConfigRuntime.js`

## Current migration inventory
- Legacy static HTML pages still present in `public/`: 15
- Legacy runtime JS files in `public/js/`: 109
- Next clients still booting legacy runtime modules via `/js/*`: 0 imports
- App-level `webpackIgnore` imports: 0

## Remaining high-priority work
1. Replace app-local legacy runtime trees (`app/**/runtime/legacy/*`) with native React/Next feature modules page-by-page.
2. De-duplicate copied legacy utilities now present in multiple runtime trees (notifications, shared nav, assistant drawer, context helpers).
3. Retire `public/*.html` and unused `public/js/*` runtime files after parity, leaving only static assets.

## Validation commands
- `npm run build`
- `npm run cap:copy`
