# Manager Flow Visuals

This folder contains source diagrams and generated visuals for the manager user guide.

## Structure

- `src/*.mmd`: Mermaid source files (editable).
- `generated/*.svg`: Rendered flow visuals (committed output).
- `screenshots/*.png`: Optional UI screenshots captured with Playwright.
- `mermaid.config.json`: Shared visual theme and layout settings.
- `puppeteer.config.json`: Headless browser config used by Mermaid CLI.

## Commands

- Render SVG diagrams:
  - `npm run docs:flows:render`
- Optimize generated SVG:
  - `npm run docs:flows:optimize`
- Full diagram build:
  - `npm run docs:flows:build`
- Capture supporting screenshots:
  - `npm run docs:flows:capture`

## Screenshot Capture Inputs

The screenshot script is optional and requires a running app server.

- `DOCS_BASE_URL` (default: `http://127.0.0.1:8081`)
- `DOCS_MANAGER_EMAIL` (optional)
- `DOCS_MANAGER_PASSWORD` (optional)
- `DOCS_MANAGER_FIRST_NAME` (optional, default: `QA`)
- `DOCS_MANAGER_LAST_NAME` (optional, default: `Manager`)

Without credentials, only unauthenticated manager flow screenshots are captured.

## Flow Diagram Set

1. `01-access-invite-sequence`
2. `02-access-decision-flow`
3. `03-daily-ops-swimlane`
4. `04-chat-message-sequence`
5. `05-request-triage-sequence`
6. `06-request-state-machine`
7. `07-confirmation-gating-flow`
8. `08-confirmation-commit-sequence`
9. `09-brand-replacement-flow`
10. `10-brand-replacement-sequence`
11. `11-notification-delivery-sequence`
12. `12-troubleshooting-routing-flow`
13. `13-editor-workflow-swimlane`
14. `14-editor-save-publish-sequence`
15. `15-analytics-decision-playbook`
16. `16-diner-experience-validation-flow`
17. `17-tablet-ops-flow`
18. `18-manager-task-map`
