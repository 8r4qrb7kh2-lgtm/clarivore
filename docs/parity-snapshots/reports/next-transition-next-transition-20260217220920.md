# Next Transition Verification Report

- Run ID: `next-transition-20260217220920`
- Generated: 2026-02-17T22:10:22.129Z
- Base URL: `http://127.0.0.1:8081`
- Target Env: `staging`
- Created restaurant: `Next Transition QA next-transition-20260217220920`
- Created slug: `next-transition-qa-next-transition-20260217220920`
- Invite token captured: yes

## Stage Results

- PASSED: Environment Validation
- PASSED: Structural Migration Checks
- PASSED: Build + Preview Smoke
- PASSED: Authenticated Browser E2E
- PASSED: Deterministic Cleanup
- PASSED: Capacitor Copy Verification
- PASSED: Git Delta Guard

## Smoke Checks

- Route /: 200 (6548 bytes)
- Route /home/: 200 (7683 bytes)
- Route /restaurants/: 200 (7943 bytes)
- Route /favorites/: 200 (7732 bytes)
- Route /dish-search/: 200 (7754 bytes)
- Route /restaurant/: 200 (8428 bytes)
- Route /account/: 200 (7759 bytes)
- Route /my-dishes/: 200 (9777 bytes)
- Route /help-contact/: 200 (11190 bytes)
- Route /report-issue/: 200 (11150 bytes)
- Route /order-feedback/: 200 (8109 bytes)
- Route /manager-dashboard/: 200 (8148 bytes)
- Route /admin-dashboard/: 200 (7770 bytes)
- Route /kitchen-tablet/: 200 (18634 bytes)
- Route /server-tablet/: 200 (21126 bytes)
- Legacy /index.html: first=308 location=/ final=200
- Legacy /home.html: first=308 location=/home/ final=200
- Legacy /restaurants.html: first=308 location=/restaurants/ final=200
- Legacy /favorites.html: first=308 location=/favorites/ final=200
- Legacy /dish-search.html: first=308 location=/dish-search/ final=200
- Legacy /restaurant.html: first=308 location=/restaurant/ final=200
- Legacy /account.html: first=308 location=/account/ final=200
- Legacy /my-dishes.html: first=308 location=/my-dishes/ final=200
- Legacy /help-contact.html: first=308 location=/help-contact/ final=200
- Legacy /report-issue.html: first=308 location=/report-issue/ final=200
- Legacy /order-feedback.html: first=308 location=/order-feedback/ final=200
- Legacy /manager-dashboard.html: first=308 location=/manager-dashboard/ final=200
- Legacy /admin-dashboard.html: first=308 location=/admin-dashboard/ final=200
- Legacy /kitchen-tablet.html: first=308 location=/kitchen-tablet/ final=200
- Legacy /server-tablet.html: first=308 location=/server-tablet/ final=200
- API /api/help-assistant/: GET=405 POST=400
- API /api/ingredient-status-sync/: GET=405 POST=410
- Legacy parity script (next-transition-qa-next-transition-20260217220920): skipped (json=undefined)

## Git Delta

- Introduced paths after cap copy: 0
- Unexpected paths: none

