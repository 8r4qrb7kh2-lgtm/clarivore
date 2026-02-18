-- Remove legacy non-table menu storage now that normalized restaurant_menu_* tables
-- are the single source of truth for menu pages, dishes, and ingredients.
ALTER TABLE public.restaurants
  DROP COLUMN IF EXISTS overlays,
  DROP COLUMN IF EXISTS menu_images,
  DROP COLUMN IF EXISTS menu_image;
