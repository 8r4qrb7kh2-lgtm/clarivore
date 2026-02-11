# Next Native Parity Matrix

## Route Matrix

| Route | Primary Client Entry | Legacy Runtime Wrapper In Path | Status |
| --- | --- | --- | --- |
| `/` | `app/page.js` | No | Next route shell |
| `/home` | `app/home/HomeClient.js` | No | React Query page |
| `/restaurants` | `app/restaurants/RestaurantsClient.js` | No | React Query page |
| `/favorites` | `app/favorites/FavoritesClient.js` | No | React Query page |
| `/dish-search` | `app/dish-search/DishSearchClient.js` | No | React client route |
| `/restaurant` | `app/restaurant/RestaurantClient.js` | No | React feature modules |
| `/account` | `app/account/AccountClient.js` | No | React client route |
| `/my-dishes` | `app/my-dishes/MyDishesClient.js` | No | React client route |
| `/help-contact` | `app/help-contact/HelpContactClient.js` | No | React client route |
| `/report-issue` | `app/report-issue/ReportIssueClient.js` | No | React client route |
| `/order-feedback` | `app/order-feedback/OrderFeedbackClient.js` | No | React client route |
| `/manager-dashboard` | `app/manager-dashboard/ManagerDashboardClient.js` | No | React client route |
| `/admin-dashboard` | `app/admin-dashboard/AdminDashboardClient.js` | No | React client route |
| `/kitchen-tablet` | `app/kitchen-tablet/KitchenTabletClient.js` | No | React client route |
| `/server-tablet` | `app/server-tablet/ServerTabletClient.js` | No | React client route |

## Wrapper Status

- Removed: `app/restaurant/runtime/*`
- Removed: `app/lib/restaurantRuntime/*`
- Removed: hydration/page wrapper bridge modules (`pageUiRuntime`, `pageEditorHydrationRuntime`, `hydrationRuntime`, `bootHydrationRuntime`)
- Removed: shell-template injection modules (`editorShellMarkup`, `reportShellMarkup`, `restaurantShellMarkup`)

## Current Standards

- Shared primitives: `app/components/ui/*`
- Query keys: `app/lib/queryKeys.js`
- App provider stack: React Query + toast in `app/providers.js`
- Restaurant source of truth: hooks/components under `app/restaurant/features/*` and `app/restaurant/hooks/*`
