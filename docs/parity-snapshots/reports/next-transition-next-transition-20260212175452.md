# Next Transition Verification Report

- Run ID: `next-transition-20260212175452`
- Generated: 2026-02-12T17:54:53.263Z
- Base URL: `http://127.0.0.1:8081`
- Target Env: `unknown`
- Created restaurant: `n/a`
- Created slug: `n/a`
- Invite token captured: no

## Stage Results

- FAILED: Environment Validation
  - Error: Missing required env vars: TARGET_ENV, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, DATABASE_URL, QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD, QA_MANAGER_EMAIL, QA_MANAGER_PASSWORD, QA_DINER_EMAIL, QA_DINER_PASSWORD, CAPACITOR_SERVER_URL
- FAILED: Deterministic Cleanup
  - Error: Command failed: psql  -v ON_ERROR_STOP=1 -c 
    DELETE FROM public.restaurant_direct_message_reads
    WHERE restaurant_id = NULL
      OR restaurant_id IN (
        SELECT id FROM public.restaurants
        WHERE name ILIKE '%' || 'next-transition-20260212175452' || '%'
           OR slug ILIKE '%' || 'next-transition-20260212175452' || '%'
      );
  
psql: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed: FATAL:  database "undefined" does not exist
- SKIPPED: Capacitor Copy Verification
  - Reason: Skipped because a prior required stage failed.
- SKIPPED: Git Delta Guard
  - Reason: Skipped because a prior required stage failed.

## Smoke Checks


