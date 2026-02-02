-- Add monitoring statistics to restaurants table
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS total_checks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS emails_sent INTEGER DEFAULT 0;

-- Update existing restaurants to count their current snapshots
UPDATE restaurants r
SET total_checks = (
  SELECT COUNT(*)
  FROM menu_snapshots
  WHERE restaurant_id = r.id
)
WHERE monitor_enabled = true;

COMMENT ON COLUMN restaurants.total_checks IS 'Total number of monitoring checks performed';
COMMENT ON COLUMN restaurants.emails_sent IS 'Total number of email notifications sent';
