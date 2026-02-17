-- Unschedule legacy Supabase Edge monitoring cron now that monitoring runs via Next.js cron route.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    BEGIN
      PERFORM cron.unschedule('monitor-restaurant-menus');
    EXCEPTION
      WHEN OTHERS THEN
        -- Ignore missing schedule or pg_cron permissions in non-production environments.
        NULL;
    END;
  END IF;
END $$;
