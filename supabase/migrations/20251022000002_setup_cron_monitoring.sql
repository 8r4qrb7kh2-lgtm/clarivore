-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule menu monitoring to run every 24 hours
-- This runs on Supabase's servers, independent of your local machine
SELECT cron.schedule(
  'monitor-restaurant-menus',
  '0 0 * * *',  -- Every day at midnight UTC (00:00)
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

-- Verify the cron job was created
SELECT jobid, schedule, command
FROM cron.job
WHERE jobname = 'monitor-restaurant-menus';
