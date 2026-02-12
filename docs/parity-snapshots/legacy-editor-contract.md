# Legacy Editor Contract

This contract defines required behavior for `editorParity=legacy` in Next.js.

## 1. Parity mode resolution

Resolution order:

1. query param `editorParity`
2. localStorage `clarivoreEditorParityMode`
3. env `NEXT_PUBLIC_EDITOR_PARITY_DEFAULT`
4. fallback `current`

Accepted values:

- `current`
- `legacy`

Invalid values must be ignored and fall back to next source in priority order.

## 2. Topbar contract (legacy parity mode)

### Required structure

- Uses legacy grouped navigation behavior.
- Includes manager mode toggle if user is manager/owner.
- Uses unsaved-change-aware navigation callbacks.

### Manager editor nav

- Dashboard
- Webpage editor
  - single link when one managed restaurant
  - dropdown when multiple managed restaurants
- Tablet pages dropdown
  - Server tablet
  - Kitchen tablet
- Help
- Account settings

### Viewer nav

- Home
- By restaurant dropdown
- By dish dropdown
- Help
- Account settings

### Auth region

- `Sign out` button when authenticated.
- `Sign in` link when unauthenticated.

## 3. Mode toggle contract

- Toggling mode updates `clarivoreManagerMode` localStorage.
- Editor mode URL includes `edit=1`.
- Viewer mode URL removes `edit`/`mode`.
- Dirty editor mode transitions must route through unsaved guard modal.

## 4. Editor shell contract

### Header

- `h1` only: `Webpage editor`
- No overlay count chips.
- No saved status chips.

### Toolbar groups and actions

- `Editing`:
  - add overlay
  - undo
  - redo
  - conditional save button
- `Menu pages`:
  - edit menu images
  - view log of changes
- `Restaurant`:
  - restaurant settings
  - confirm information is up-to-date

### Hidden in legacy parity mode

- detect dishes action and mapping panel
- always-visible save button
- zoom controls
- next-only header chrome

## 5. Overlay interaction contract

- Overlay coordinates normalized into visible bounds.
- Per-page rendering based on normalized `pageIndex`.
- Drag/move and corner resize active.
- Active overlay style and edit badge present.
- Pointer capture used for drag/resize robustness.
- Undo/redo keyboard shortcuts active.

## 6. Save flow contract

- Save button hidden until dirty/saving/saved/error state.
- State labels:
  - `Saving...`
  - `Saved`
  - `Retry save`
- Save path opens review modal before final save.
- Review modal supports confirm/cancel and surfaces save error text.
- Saved state auto-resets to idle after short timeout.

## 7. Unsaved-change guard contract

Guard triggers when dirty editor would be exited by:

- mode toggle
- topbar link navigation
- internal anchor navigation intercept
- any queued route push/replace via shared helper
- browser unload

Guard modal must support:

- `Stay here` (cancel navigation)
- `Leave without saving` (discard draft, then navigate)
- `Save then leave` (save, then navigate if save succeeds)

## 8. Menu scanner contract

Scanner must support:

- upload file scan
- camera capture scan
- replace existing page scan
- backend corner detection request (`detect-corners`)
- manual corner drag adjustment
- crop confirmation
- tall-image auto split into sections
- overlay page remap on split/replace

Failure handling:

- detection failure message shown
- user can still manually adjust and continue
- fallback crop path available when perspective warp runtime is unavailable

## 9. CSS ownership contract

- Legacy parity route class `restaurant-parity-legacy` set on `body`.
- Legacy visual classes are sourced from `public/css/styles.css`.
- Global Next-only overrides for shared legacy selectors must not apply when `body.restaurant-parity-legacy` is present.

## 10. Verification contract

Required validation:

- Visual snapshots:
  - desktop + mobile
  - editor + viewer
  - single-page + multi-page menu
- E2E assertions:
  - topbar grouping/dropdowns
  - editor toolbar composition
  - overlay visibility and manipulation
  - save states + review modal
  - unsaved guard flows
  - scanner upload/corner/split flow

Rollout:

1. default `current` in production
2. query override internal QA
3. staging default `legacy`
4. pass visual + E2E gates
5. production default `legacy`
6. keep emergency `editorParity=current` rollback window
