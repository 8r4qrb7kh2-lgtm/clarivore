-- Drop currently-unused public indexes that are redundant with existing access paths.

DROP INDEX IF EXISTS public.idx_menu_snapshots_restaurant_detected_desc;
DROP INDEX IF EXISTS public.restaurant_menu_ingredient_brand_items_restaurant_idx;
