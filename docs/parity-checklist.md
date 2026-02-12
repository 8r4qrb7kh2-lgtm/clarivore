# Parity Checklist

This checklist tracks route-level parity for the full Next-native rewrite.

## User Routes

- [x] `/`
- [x] `/home`
- [x] `/restaurants`
- [x] `/favorites`
- [x] `/dish-search`
- [x] `/restaurant`
- [x] `/account`
- [x] `/my-dishes`
- [x] `/help-contact`
- [x] `/report-issue`
- [x] `/order-feedback`
- [x] `/manager-dashboard`
- [x] `/admin-dashboard`
- [x] `/kitchen-tablet`
- [x] `/server-tablet`

## Critical Flows

- [x] Restaurant viewer: menu overlay selection, compatibility status, dish details, add-to-order.
- [x] Restaurant editor: overlay add/edit/remove, position/size edits, save overlays to `restaurants.overlays`.
- [x] Restaurant order notice: selected dishes, diner form, notice submit, status refresh.
- [x] Manager/admin/tablet route access and auth redirects.
- [x] Favorites toggle flow and favorite list rendering.

## Architecture Checks

- [x] No active runtime wrappers under `app/restaurant/runtime/*`.
- [x] No active `app/lib/restaurantRuntime/*` dependency chain.
- [x] No deprecated runtime constants in `app/*`.
- [x] Restaurant route uses React hooks/components as source of truth.

## Legacy Editor Parity Gates

- [x] Query override supports `editorParity=legacy|current`.
- [x] Env default supports `NEXT_PUBLIC_EDITOR_PARITY_DEFAULT`.
- [x] localStorage sticky mode supports `clarivoreEditorParityMode`.
- [x] Legacy topbar parity path enabled behind parity switch.
- [x] Legacy editor shell parity path enabled behind parity switch.
- [x] Unsaved navigation guard covers mode toggle + nav + beforeunload.
- [x] Scanner flow supports corner detect + manual adjust + split remap.
- [x] `detect-corners` Supabase edge function added to repo.
- [x] Dedicated parity verification script exists and is wired into transition harness.
