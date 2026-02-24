-- Targeted index improvements for high-frequency read paths and sorted history lookups.

CREATE INDEX IF NOT EXISTS idx_restaurants_name
  ON public.restaurants (name);

CREATE INDEX IF NOT EXISTS idx_ingredient_scan_appeals_restaurant_submitted
  ON public.ingredient_scan_appeals (restaurant_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_menu_snapshots_restaurant_detected_desc
  ON public.menu_snapshots (restaurant_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_logs_restaurant_timestamp_desc
  ON public.change_logs (restaurant_id, "timestamp" DESC);
