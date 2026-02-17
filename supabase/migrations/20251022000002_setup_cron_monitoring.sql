-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule menu monitoring.
-- This migration intentionally avoids embedding API keys in source control.
-- Configure these settings in your DB environment before execution:
--   app.settings.supabase_functions_url
--   app.settings.supabase_service_role_key
-- Example:
--   ALTER DATABASE postgres SET app.settings.supabase_functions_url = 'https://<project-ref>.supabase.co/functions/v1';
--   ALTER DATABASE postgres SET app.settings.supabase_service_role_key = '<service-role-jwt>';

DO $$
DECLARE
  functions_url text := current_setting('app.settings.supabase_functions_url', true);
  service_role_key text := current_setting('app.settings.supabase_service_role_key', true);
BEGIN
  IF COALESCE(functions_url, '') = '' OR COALESCE(service_role_key, '') = '' THEN
    RAISE NOTICE 'Skipping cron schedule: set app.settings.supabase_functions_url and app.settings.supabase_service_role_key first.';
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

-- Verify the cron job was created
SELECT jobid, schedule, command
FROM cron.job
WHERE jobname = 'monitor-restaurant-menus';
