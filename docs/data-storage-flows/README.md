# Clarivore Data Storage Flow Maps (Axon-backed)

These diagrams map Clarivore runtime storage flows using Axon call-graph data plus direct table-access scans from active Next.js runtime code under `app/`.

Generated on: 2026-02-24.

## Axon basis

- Repository stats (Axon): `352` files, `1947` symbols, `88` endpoints, `3686` call relationships.
- Primary Axon endpoints used:
  - `/api/v1/repositories/2/stats`
  - `/api/v1/search`
  - `/api/v1/mcp/tools/get_symbol_context`

## Diagram set

- `src/01-storage-topology.mmd`: end-to-end storage topology and boundaries.
- `src/02-gateway-write-sequence.mmd`: strict gateway write sequence.
- `src/03-read-hydration-flow.mmd`: read/hydration paths from normalized menu tables.
- `src/04-non-boundary-write-domains.mmd`: sanctioned non-boundary writes.
- `src/05-boundary-enforcement-flow.mmd`: DB trigger enforcement and failure path.
- `src/06-normalized-table-model.mmd`: canonical table model and compatibility dual-write model.
- `generated/*.svg`: rendered diagrams from the Mermaid sources above.

All interaction nodes in `01` through `05` now include:

- allowed user type(s)
- page/route or system surface where the interaction occurs

Render command:

- `npx --yes @mermaid-js/mermaid-cli -i docs/data-storage-flows/src/<name>.mmd -o docs/data-storage-flows/generated/<name>.svg`

## Access and page matrix

| Flow | Interaction | Allowed user type(s) | Page/Surface |
|---|---|---|---|
| `01-storage-topology` | `useRestaurantPersistence` -> `/api/restaurant-write/stage|commit` | manager/owner with restaurant access, app admin | `/restaurant`, `/admin-dashboard` |
| `01-storage-topology` | `useManagerChat`, help chat | manager/owner, app admin | `/manager-dashboard`, `/help-contact`, `/admin-dashboard` |
| `01-storage-topology` | account/favorites preference writes | signed-in end users | `/account`, `/favorites`, `/restaurants` |
| `01-storage-topology` | order + tablet writes | diners and staff/managers | `/restaurant`, `/kitchen-tablet`, `/server-tablet` |
| `01-storage-topology` | `/api/monitor-menus` | system key/cron only | Vercel cron/system call |
| `01-storage-topology` | `/api/report-issue` | any user (guest or signed-in) | `/help-contact`, `/report-issue` |
| `01-storage-topology` | `/api/ingredient-scan-appeals` | authenticated manager/owner for restaurant, app admin | `/restaurant` |
| `01-storage-topology` | `/api/order-feedback/submit` | feedback-token holder | `/order-feedback` |
| `01-storage-topology` | `/api/admin/managers` | app admin | `/admin-dashboard` |
| `02-gateway-write-sequence` | stage + commit sequence | manager/owner with restaurant access, app admin | `/restaurant`, `/admin-dashboard` |
| `02-gateway-write-sequence` | system monitor -> `/api/restaurant-write/system` | system key/cron secret only | Vercel cron/service-to-service |
| `03-read-hydration-flow` | `loadRestaurantBoot` | signed-in diner, manager/owner, app admin | `/restaurant` |
| `03-read-hydration-flow` | `hydrateRestaurantsWithTableMenuState` | guest + signed-in users | `/restaurants`, `/favorites`, `/home`, `/guest`, `/dish-search` |
| `03-read-hydration-flow` | `fetchRestaurantChangeLogs` | manager/owner, app admin | `/restaurant`, `/manager-dashboard` |
| `03-read-hydration-flow` | `fetchAccessibleTabletOrders` | staff/managers with restaurant access | `/kitchen-tablet`, `/server-tablet` |
| `04-non-boundary-write-domains` | `saveAllergies` / `saveDiets` | signed-in end users | `/account` |
| `04-non-boundary-write-domains` | `grantManagerInviteAccess` | signed-in invited user | `/account` |
| `04-non-boundary-write-domains` | favorite + loved dish writes | signed-in diner/owner/manager | `/favorites`, `/restaurants`, `/restaurant`, `/my-dishes` |
| `04-non-boundary-write-domains` | `useOrderFlow` + `upsertTabletOrder` | diners and staff/managers | `/restaurant`, `/kitchen-tablet`, `/server-tablet` |
| `04-non-boundary-write-domains` | manager push registration | manager/owner | `/manager-dashboard`, `/help-contact` |
| `04-non-boundary-write-domains` | diner push registration helper | diner | no active page caller in current runtime |
| `05-boundary-enforcement-flow` | gateway-context writes | manager/owner/app admin + system path | `/restaurant`, `/admin-dashboard`, cron/service |
| `05-boundary-enforcement-flow` | direct non-gateway writes | blocked for all callers | rejected by trigger (`42501`) |

## Axon symbol anchors

- Gateway core:
  - `applyWriteOperations` (9396)
  - `syncIngredientStatusFromOverlays` (9391)
  - `setRestaurantWriteContext` (9393)
  - `bumpRestaurantWriteVersion` (9392)
- Gateway routes:
  - stage `POST` (9403)
  - commit `POST` (9397)
  - system `POST` (9406)
  - monitor `POST` (9278) -> `applyMonitoringStatsWrite` (9277)
- Gateway client/read callers:
  - `useRestaurantPersistence` (10003)
  - `stageRestaurantWrite` (9821)
  - `commitRestaurantWrite` (9822)
  - `loadCurrentRestaurantWrite` (9824)
  - `loadRestaurantBoot` (9994)
  - `hydrateRestaurantWithTableMenuState` (9780)
  - `fetchRestaurantMenuStateMapFromTables` (9778)
  - `fetchRestaurantChangeLogs` (9588)
- Non-boundary write anchors:
  - `saveAllergies` (9045), `saveDiets` (9046), `grantManagerInviteAccess` (9048)
  - `toggleFavorite` (9541, 10325)
  - `useOrderFlow` (10227), `upsertTabletOrder` (9833), `fetchAccessibleTabletOrders` (9832)
  - `useManagerChat` (9880)
  - `initManagerNotifications` (9763), `initDinerNotifications` (9623)
  - API routes: report issue `POST` (9312), ingredient appeals `POST` (9264), order feedback submit `POST` (9309), admin managers `POST` (9077)

## Scope note

`archive/` was intentionally excluded. All edges in these maps are from active runtime paths in `app/` and current SQL migrations.
