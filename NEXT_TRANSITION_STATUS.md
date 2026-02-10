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
- Removed redundant dashboard fallback imports and files from app-local legacy trees:
  - `admin-dashboard` legacy tree reduced to 2 files
  - `manager-dashboard` legacy tree reduced to 5 files
- Consolidated duplicated manager chat notification logic into `app/lib/chatNotifications.js`.
- Consolidated help-assistant drawer logic through shared app module usage (restaurant legacy `shared-nav` now imports `app/lib/helpAssistantDrawer.js`).
- Introduced shared topbar components in `app/components/SimpleTopbar.js`:
  - `SimpleTopbar` for common brand/nav/auth shell
  - `ManagerModeSwitch` for editor/customer mode toggles
- Refactored 14 app routes/components to use shared `SimpleTopbar`, including restaurant shell compatibility usage.
- Raw app-level `simple-topbar` markup is now fully removed from page components.

## Current migration inventory
- Legacy static HTML pages still present in `public/`: 15
- Legacy runtime JS files in `public/js/`: 109
- Next clients still booting legacy runtime modules via `/js/*`: 0 imports
- App-level `webpackIgnore` imports: 0
- App-local legacy runtime files:
  - `app/admin-dashboard/runtime/legacy`: 2
  - `app/manager-dashboard/runtime/legacy`: 5
  - `app/restaurant/runtime/legacy`: 90
- App routes still rendering raw topbar markup directly: 0

## Remaining high-priority work
1. Replace app-local legacy runtime trees (`app/**/runtime/legacy/*`) with native React/Next feature modules page-by-page.
2. De-duplicate remaining copied legacy utilities in `app/restaurant/runtime/legacy/*` against shared app modules.
3. Retire `public/*.html` and unused `public/js/*` runtime files after parity, leaving only static assets.

## Validation commands
- `npm run build`
- `npm run cap:copy`
