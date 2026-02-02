-- Update menu monitoring frequency from every 6 hours to every 24 hours

-- First, unschedule the existing job
SELECT cron.unschedule('monitor-restaurant-menus');

-- Create new schedule for every 24 hours (daily at midnight UTC)
SELECT cron.schedule(
  'monitor-restaurant-menus',
  '0 0 * * *',  -- Every day at midnight (00:00 UTC)
  $$
  SELECT net.http_post(
    url := 'https://fgoiyycctnwnghrvsilt.supabase.co/functions/v1/monitor-menus',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1MjYsImV4cCI6MjA3NjAxMjUyNn0.xlSSXr0Gl7j-vsckrj-2anpPmp4BG2SUIdN-_dquSA8',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1MjYsImV4cCI6MjA3NjAxMjUyNn0.xlSSXr0Gl7j-vsckrj-2anpPmp4BG2SUIdN-_dquSA8'
    )
  );
  $$
);

-- Verify the cron job was updated
SELECT
  jobid,
  jobname,
  schedule,
  active,
  CASE
    WHEN schedule = '0 0 * * *' THEN '✓ Updated to daily (midnight UTC)'
    ELSE '⚠ Schedule not updated correctly'
  END as status
FROM cron.job
WHERE jobname = 'monitor-restaurant-menus';
