-- Add dishes_json column to menu_snapshots table to store extracted dishes
ALTER TABLE menu_snapshots
ADD COLUMN IF NOT EXISTS dishes_json TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN menu_snapshots.dishes_json IS 'JSON string of extracted dishes with name and description for efficient comparison';
