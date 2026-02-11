# Runtime Decommissioned

This migration removes the legacy restaurant runtime wrapper architecture and replaces it with route-native React modules.

## Removed Wrapper Entry Points

- `app/restaurant/runtime/restaurantPageRuntime.js`
- `app/restaurant/runtime/createRestaurantRuntimeCore.js`
- `app/restaurant/runtime/createRestaurantRuntimeCoreOptions.js`
- `app/restaurant/runtime/createRestaurantPageUiBundle.js`
- `app/restaurant/runtime/createRestaurantPageUiBundleOptions.js`
- `app/restaurant/runtime/createRestaurantEditorHydrationBundle.js`
- `app/restaurant/runtime/createRestaurantEditorHydrationBundleOptions.js`
- `app/restaurant/runtime/createRestaurantRuntimeBrowserServices.js`
- `app/restaurant/runtime/scriptLoader.js`
- `app/restaurant/runtime/runtimeEnvironment.js`

## Removed Wrapper Hydration/Composition Helpers

- `app/lib/pageUiRuntime.js`
- `app/lib/pageEditorHydrationRuntime.js`
- `app/lib/hydrationRuntime.js`
- `app/lib/bootHydrationRuntime.js`
- `app/lib/pageCoreRuntime.js`
- `app/lib/pageEditorHydrationOptionsRuntime.js`
- `app/lib/pageOffsetRuntime.js`
- `app/lib/pageRouterRuntime.js`
- `app/lib/pageServicesRuntime.js`
- `app/lib/pageUiOptionsRuntime.js`
- `app/lib/pageUtilsRuntime.js`

## Removed Legacy Restaurant Runtime Module Tree

- Entire folder removed: `app/lib/restaurantRuntime/`

## Removed Shell/Template Injection Layer

- `app/lib/editorShellMarkup.js`
- `app/lib/reportShellMarkup.js`
- `app/lib/restaurantShellMarkup.js`
- `app/lib/restaurantReportPageRuntime.js`
- `app/restaurant/components/RestaurantCoreDom.js`
- `app/restaurant/components/RestaurantShellTemplate.js`
- `app/restaurant/components/RestaurantEditorShellTemplate.js`
- `app/restaurant/components/RestaurantReportShellTemplate.js`

## React Replacements

- Restaurant route controller:
  - `app/restaurant/RestaurantClient.js`
- Viewer hook + component:
  - `app/restaurant/hooks/useRestaurantViewer.js`
  - `app/restaurant/features/viewer/RestaurantViewer.js`
- Editor hook + component:
  - `app/restaurant/hooks/useRestaurantEditor.js`
  - `app/restaurant/features/editor/RestaurantEditor.js`
- Order flow hook + component:
  - `app/restaurant/hooks/useOrderFlow.js`
  - `app/restaurant/features/order/RestaurantOrderFlowPanel.js`
- Manager actions hook:
  - `app/restaurant/hooks/useManagerActions.js`
- Shared compatibility logic:
  - `app/restaurant/features/shared/compatibility.js`
