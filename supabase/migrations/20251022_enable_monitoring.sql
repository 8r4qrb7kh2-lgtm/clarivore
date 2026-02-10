-- Enable monitoring for all existing restaurants
UPDATE restaurants
SET monitor_enabled = true
WHERE slug IN ('falafel-cafe', 'guarinos', 'mama-santa-s');

-- Set menu URLs for restaurants if not already set
UPDATE restaurants
SET menu_url = 'https://clarivore.org/restaurant?slug=' || slug
WHERE menu_url IS NULL
  AND slug IN ('falafel-cafe', 'guarinos', 'mama-santa-s');

-- Verify the update
SELECT id, name, slug, menu_url, monitor_enabled
FROM restaurants
WHERE slug IN ('falafel-cafe', 'guarinos', 'mama-santa-s');
