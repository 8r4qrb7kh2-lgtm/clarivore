-- Appeals now live on restaurant_menu_ingredient_rows.ingredient_payload.brandAppeal
-- with changelog history in public.change_logs, so the duplicate table is no longer needed.

DROP TABLE IF EXISTS public.ingredient_scan_appeals;
