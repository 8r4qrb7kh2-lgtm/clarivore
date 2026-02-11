# Next.js Transition Status

## Current State

The app is now running on a Next-native architecture across all user routes.

- Routing: Next App Router (`app/*/page.js`) for all user surfaces.
- Data: React Query provider and cache in `app/providers.js`.
- Styling: Tailwind pipeline active (`tailwind.config.js`, `postcss.config.js`, `@tailwind` directives in `app/globals.css`).
- Shared UI primitives: `app/components/ui/*`.
- Restaurant route (`/restaurant`): React hooks/components as source of truth.

## Completed Runtime Decommission

Removed previous runtime wrapper architecture:

- `app/restaurant/runtime/*`
- `app/lib/restaurantRuntime/*`
- `app/lib/pageUiRuntime.js`
- `app/lib/pageEditorHydrationRuntime.js`
- `app/lib/hydrationRuntime.js`
- `app/lib/bootHydrationRuntime.js`
- Shell-template bridge modules (`editorShellMarkup`, `reportShellMarkup`, `restaurantShellMarkup`)

## Restaurant Route (React-native)

Implemented in:

- `app/restaurant/RestaurantClient.js`
- `app/restaurant/hooks/useRestaurantViewer.js`
- `app/restaurant/hooks/useRestaurantEditor.js`
- `app/restaurant/hooks/useOrderFlow.js`
- `app/restaurant/hooks/useManagerActions.js`
- `app/restaurant/features/viewer/RestaurantViewer.js`
- `app/restaurant/features/editor/RestaurantEditor.js`
- `app/restaurant/features/order/RestaurantOrderFlowPanel.js`
- `app/restaurant/features/shared/compatibility.js`

## API Architecture

Backend endpoint architecture is finalized on Next route handlers:

- `app/api/ai-proxy/route.js`
- `app/api/ingredient-status-sync/route.js`

`output: "export"` is no longer used.

## Verification Targets

- `npm run build`
- `npm run cap:copy`
- `npm run preview` smoke checks for all user routes
