# Clarivore Manager User Guide

This guide is a practical reference for restaurant managers using Clarivore's manager tools.

## What This Guide Covers

- Getting access and signing in
- Running daily manager workflows
- Handling direct messages and accommodation requests
- Completing monthly confirmation
- Using brand replacement and menu analytics tools
- Troubleshooting common issues

## Quick Start

1. Open `/account` and sign in.
2. If you were invited, use the invite link (for example `/account?invite=...`).
3. After login, managers are sent to `/manager-dashboard`.
4. If you have manager rights, use the topbar mode toggle to switch modes.
5. `Manager` mode opens `/manager-dashboard`.
6. `Customer` mode opens `/home`.

## Access Rules

- You must be signed in to use manager features.
- You must have manager access to at least one restaurant.
- Owners can access all restaurants and see a restaurant selector in the dashboard.
- Non-owner managers only see restaurants assigned to them. The dashboard opens on their first assigned restaurant.

## Daily Operating Checklist

1. Open `/manager-dashboard`.
2. Check `Direct Messages` and acknowledge unread admin/system messages.
3. Process `Accommodation Requests` in `Pending`.
4. Review `Menu Confirmation` due status.
5. Review `Recent changes` and `Brand items in use` for risky updates.
6. Scan `Menu Interest Heatmap` and `User Dietary Profile Breakdown` for demand patterns.

## Dashboard Reference

### Direct Messages

Use this panel for manager-to-admin communication.

- `Send`: send a message to Clarivore admin from your current restaurant context.
- `Acknowledge message(s)`: marks admin-sent messages as read/acknowledged.
- Unread badge count tracks admin messages you have not acknowledged.
- Message links to Clarivore pages are resolved as in-app links.

Recommended usage:

- Send short, concrete updates (what changed, what is blocked, what is needed).
- Acknowledge after reviewing action items so unread count returns to zero.

### Accommodation Requests

This panel is your request triage queue.

- Tabs available: `Pending` (only unresolved requests) and `All` (full history).
- Per request, review dish name, requested allergens/diets, request date, current status, and optional previous manager response.

Available actions for `pending` requests:

- `Mark Implemented`
- `Mark Reviewed`
- `Decline`

Each action opens a modal where you can add an optional manager response.

Status guidance:

- `implemented`: Use when a real menu/process accommodation is now in place.
- `reviewed`: Use when you assessed it but did not implement a change yet.
- `declined`: Use when the request cannot be supported.

Important behavior:

- Action buttons are shown only for pending requests.
- After status changes, the request remains visible in `All` with your response.

### Menu Confirmation

This card shows your monthly confirmation health.

- `Due in N days`, `Due today`, or `X days overdue`
- `Last confirmed: <date>`
- `Confirm information is up-to-date`

When you click confirm, Clarivore opens the editor confirmation flow.

#### Confirmation Flow (2 Steps)

Step 1: Menu verification

1. Provide a current photo (or replacement) for each saved menu page.
2. For removed pages, mark them removed.
3. Answer both attestation questions `Yes`.
4. Confirm all dishes are clearly visible.
5. Confirm photos are your most current menu.
6. Wait for comparison checks to finish.
7. Continue only when pages are matched/replaced and no comparison is pending.

Step 2: Brand item verification

1. Review each brand item card.
2. If mismatched, capture a new photo or replace the brand item.
3. Confirm when all brand items are matched.

Final submit:

- Click `Confirm information is up-to-date` to record confirmation.

### Recent Changes

This panel gives a short view of recent menu edits.

- Shows recent log entries.
- `View full changelog` opens the full log inside the editor.

Use this before and after major updates so you can spot unintended edits quickly.

### Brand Items in Use

This panel helps track ingredients/products used across dishes.

- Search by brand, ingredient, or dish.
- Expand an item to view allergens, diets, and linked dishes.
- `Open` on a dish deep-links into the editor with AI panel context for that dish/ingredient.
- `Replace item` starts the guided brand replacement flow in the editor.

Critical detail:

- Brand replacement is staged in draft overlays first.
- Replacements do not go live until you finish row confirmations and save to site.

### Menu Interest Heatmap

This visual overlays menu regions with demand/safety metrics.

Metric toggles:

- `Total views`
- `Total loves`
- `Total orders`
- `Total requests`
- `Proportion of views safe/accommodable` (% accommodated)

How to use:

1. Pick a metric.
2. Click highlighted dish areas to inspect dish-level analytics.
3. Use page controls for multi-page menus.
4. Review the accommodation breakdown panel below the heatmap.

### User Dietary Profile Breakdown

This section summarizes dietary/allergen distribution of users who viewed the menu.

- Pie chart: allergens
- Pie chart: diets
- Includes users with no listed allergens/diets as separate categories

Use this to prioritize which accommodations likely benefit the most guests.

## Brand Replacement SOP

Use this when a product/brand changed (for example, supplier swap).

1. In `Brand items in use`, find the old brand item.
2. Click `Replace item`.
3. In editor flow, capture/scan the replacement product label.
4. Let Clarivore stage replacements across matching ingredient rows.
5. Reconfirm affected ingredient rows.
6. Save to site.
7. Re-run `Menu Confirmation` if needed.

If no rows were updated, verify you selected the correct brand item and try again.

## Request Triage SOP

Use this sequence for consistent handling.

1. Open `Accommodation Requests` in `Pending`.
2. Group by repeated dish or repeated allergen pattern.
3. Choose one action per request.
4. Use `implemented` if solved in menu/process.
5. Use `reviewed` if acknowledged but pending future work.
6. Use `declined` if unsupported.
7. Add a concise response message for audit history.
8. Check `All` tab to verify status and response were recorded.

## Notifications and Reminders

Manager notifications can include in-app indicators and external notifications depending on deployment setup.

- Browser/native push registration runs during manager boot.
- Web push permission is requested after user interaction (first click-triggered request).
- Confirmation reminders are auto-generated near due date (7, 3, 2, and 1 days before due).

If notifications are missing:

1. Confirm browser/system notification permissions are allowed.
2. Check that you are signed in with the correct manager account.
3. Refresh dashboard and send a test chat message.
4. If still broken, escalate to admin for environment key/subscription checks.

## Troubleshooting

### "Sign in Required"

Cause: no active user session.

Fix:

1. Go to `/account`.
2. Sign in.
3. Return to `/manager-dashboard`.

### "Manager Access Required"

Cause: signed in, but no manager assignment exists.

Fix:

1. Ask admin to assign your user to restaurant manager access.
2. If you received an invite link, re-open it and complete invite flow.

### Dashboard load errors

Cause: data query failure or runtime configuration issue.

Fix:

1. Refresh the page.
2. Switch to another network and retry.
3. If persistent, provide timestamp + action to admin for logs.

### No menu image available in heatmap

Cause: menu images or overlays are missing for current restaurant.

Fix:

1. Open webpage editor.
2. Upload/update menu pages and overlays.
3. Save to site.
4. Return to dashboard.

### Request action failed

Cause: update failed while writing request status.

Fix:

1. Retry once.
2. Confirm you are still on the same restaurant.
3. If repeated, copy the request details and escalate.

### Brand replacement ran but site did not change

Cause: replacements were only staged in draft.

Fix:

1. Reconfirm updated ingredient rows.
2. Click save to site.
3. Verify change in changelog/preview.

## Manager Status Glossary

- `Pending request`: untriaged accommodation request.
- `Implemented`: request addressed with a concrete menu/process change.
- `Reviewed`: request assessed, not fully implemented.
- `Declined`: request not supported.
- `Due soon`: confirmation due within 7 days.
- `Overdue`: confirmation due date has passed.

## Recommended Weekly Review

1. Clear pending accommodation requests.
2. Confirm direct-message unread count is zero.
3. Review top heatmap dishes by views and requests.
4. Check high-demand unsafe dishes and plan accommodations.
5. Verify menu confirmation is not approaching overdue.

## Escalation Checklist (When Contacting Admin)

Include the following to speed resolution:

- Restaurant name
- Exact page URL
- What action you took
- Error message shown
- Approximate timestamp
- Screenshot if available
