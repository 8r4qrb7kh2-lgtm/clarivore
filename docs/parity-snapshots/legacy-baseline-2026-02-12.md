# Legacy Editor Baseline (2026-02-12)

## Baseline source

- Source of truth URL: `https://clarivore.org/restaurant.html?slug=demo-menu&edit=1`
- Baseline freeze date: **2026-02-12**
- Scope: manager/editor mode only for the restaurant webpage editor.

## Locked baseline behaviors

### Topbar and mode toggle

- Left mode toggle shows `Editor mode` text and switch.
- Brand centered with Clarivore logo and label.
- Manager nav order:
  - Dashboard
  - Webpage editor
  - Tablet pages
  - Help
  - Account settings
- Auth action on right shows `Sign out` when authenticated.
- Toggle editor/customer mode updates URL query parameters (`edit=1` when editor).

### Editor shell

- Heading is plain `Webpage editor` text (`h1`) with no extra chips in legacy mode.
- Header row layout:
  - page thumbnail card at left
  - three toolbar groups across:
    - `Editing`
    - `Menu pages`
    - `Restaurant`
- Overlay count and save chips are not displayed in legacy shell.
- Helper note row text:
  - `Drag to move. Drag any corner to resize. Click ✏️ to edit details.`

### Toolbar actions

- `Editing` group:
  - `+ Add overlay`
  - `Undo`
  - `Redo`
  - save button appears only after dirty changes
- `Menu pages` group:
  - `Edit menu images`
  - `View log of changes`
- `Restaurant` group:
  - `Restaurant settings`
  - `Confirm information is up-to-date`
- Non-legacy editor controls must remain hidden in legacy parity mode:
  - always-visible save button
  - detect dishes button/wizard UI
  - zoom controls
  - extra status chips

### Overlay interaction

- Overlays are visible on correct page and remain within page bounds.
- Overlay box supports:
  - drag move
  - corner resize
  - active highlight
  - edit badge (`✏️`)
- Keyboard shortcuts:
  - undo: `Cmd/Ctrl + Z`
  - redo: `Cmd/Ctrl + Shift + Z` and `Cmd/Ctrl + Y`

### Save lifecycle

- Save button hidden until editor state is dirty.
- Save states:
  - `Saving...`
  - `Saved`
  - `Retry save`
- Save is gated by pre-save review modal in legacy parity mode.

### Unsaved navigation guard

- Guard applies when leaving dirty editor mode by:
  - topbar links
  - mode toggle
  - internal route pushes
  - browser tab close (`beforeunload`)
- Prompt offers:
  - stay
  - leave without saving
  - save then leave

### Menu image scanner flow

- Flow supports:
  - upload/camera source
  - backend corner detection call
  - manual corner adjustment
  - crop/warp apply
  - tall-image split
  - overlay page remap on replace/split
- Detection failure returns explicit message and keeps manual adjustment path available.

## Release gate requirements

- Visual parity screenshots must exist for desktop and mobile variants.
- E2E parity checks must pass for topbar, editor shell, overlay interactions, save flow, unsaved guard, and scanner flow.
- Production rollout must remain flaggable via:
  - `editorParity` query param
  - `NEXT_PUBLIC_EDITOR_PARITY_DEFAULT`
  - `clarivoreEditorParityMode` localStorage override
