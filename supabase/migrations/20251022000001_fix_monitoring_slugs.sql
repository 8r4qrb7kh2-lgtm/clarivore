-- Fix: Enable monitoring for the correct restaurant slugs
UPDATE restaurants
SET monitor_enabled = true
WHERE slug IN ('guarinos', 'mama-santa-s');

-- Set menu URLs for Guarinos and Mama Santa's
UPDATE restaurants
SET menu_url = 'https://clarivore.org/restaurant.html?slug=' || slug
WHERE menu_url IS NULL
  AND slug IN ('guarinos', 'mama-santa-s');

-- Verify all three restaurants are now enabled
SELECT id, name, slug, menu_url, monitor_enabled
FROM restaurants
WHERE slug IN ('falafel-cafe', 'guarinos', 'mama-santa-s');
