-- Add check frequency configuration to restaurants table
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS check_frequency_hours INTEGER DEFAULT 6;

COMMENT ON COLUMN restaurants.check_frequency_hours IS 'How often to check menu in hours (e.g., 6 = every 6 hours)';
