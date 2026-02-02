-- Add menu monitoring fields to restaurants table
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS menu_url TEXT,
ADD COLUMN IF NOT EXISTS last_checked TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS monitor_enabled BOOLEAN DEFAULT false;

-- Create menu_snapshots table to store historical menu content
CREATE TABLE IF NOT EXISTS menu_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  menu_text TEXT NOT NULL,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_menu_snapshots_restaurant_id
  ON menu_snapshots(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_menu_snapshots_detected_at
  ON menu_snapshots(detected_at DESC);

-- Create a view for latest menu changes
CREATE OR REPLACE VIEW menu_changes AS
SELECT
  r.id as restaurant_id,
  r.name as restaurant_name,
  r.menu_url,
  current_snapshot.detected_at as last_change,
  previous_snapshot.detected_at as previous_change,
  current_snapshot.content_hash as current_hash,
  previous_snapshot.content_hash as previous_hash,
  CASE
    WHEN current_snapshot.content_hash != previous_snapshot.content_hash
    THEN true
    ELSE false
  END as has_changed
FROM restaurants r
LEFT JOIN LATERAL (
  SELECT * FROM menu_snapshots
  WHERE restaurant_id = r.id
  ORDER BY detected_at DESC
  LIMIT 1
) current_snapshot ON true
LEFT JOIN LATERAL (
  SELECT * FROM menu_snapshots
  WHERE restaurant_id = r.id
  ORDER BY detected_at DESC
  LIMIT 1 OFFSET 1
) previous_snapshot ON true
WHERE r.monitor_enabled = true;

-- Enable RLS
ALTER TABLE menu_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'menu_snapshots'
    AND policyname = 'Menu snapshots are viewable by authenticated users'
  ) THEN
    CREATE POLICY "Menu snapshots are viewable by authenticated users"
      ON menu_snapshots FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'menu_snapshots'
    AND policyname = 'Menu snapshots are insertable by service role'
  ) THEN
    CREATE POLICY "Menu snapshots are insertable by service role"
      ON menu_snapshots FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END
$$;

-- Optional: Set up pg_cron to run the monitor automatically
-- Run this in Supabase SQL Editor after deploying the edge function:
--
-- SELECT cron.schedule(
--   'monitor-restaurant-menus',
--   '0 */6 * * *',  -- Every 6 hours
--   $$
--   SELECT net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/monitor-menus',
--     headers := '{"Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
--   );
--   $$
-- );

COMMENT ON TABLE menu_snapshots IS 'Stores historical snapshots of restaurant menus for change detection';
COMMENT ON COLUMN restaurants.menu_url IS 'URL of the restaurant menu page to monitor';
COMMENT ON COLUMN restaurants.monitor_enabled IS 'Whether to include this restaurant in automated monitoring';
