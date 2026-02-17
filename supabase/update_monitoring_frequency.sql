-- Update menu monitoring frequency to daily without embedding credentials in source.
-- Requires DB settings:
--   app.settings.supabase_functions_url
--   app.settings.supabase_service_role_key

DO $$
DECLARE
  functions_url text := current_setting('app.settings.supabase_functions_url', true);
  service_role_key text := current_setting('app.settings.supabase_service_role_key', true);
BEGIN
  IF COALESCE(functions_url, '') = '' OR COALESCE(service_role_key, '') = '' THEN
    RAISE NOTICE 'Skipping cron update: set app.settings.supabase_functions_url and app.settings.supabase_service_role_key first.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('monitor-restaurant-menus');

  PERFORM cron.schedule(
    'monitor-restaurant-menus',
    '0 0 * * *',
    format(
      $cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', %L,
          'apikey', %L
        )
      );
      $cmd$,
      functions_url || '/monitor-menus',
      'Bearer ' || service_role_key,
      service_role_key
    )
  );
END $$;

SELECT
  jobid,
  jobname,
  schedule,
  active,
  CASE
    WHEN schedule = '0 0 * * *' THEN 'updated to daily (midnight UTC)'
    ELSE 'schedule differs from expected daily trigger'
  END AS status
FROM cron.job
WHERE jobname = 'monitor-restaurant-menus';
