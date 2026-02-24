-- Harden runtime-created menu and editor lock tables.
-- These tables are read by clients via PostgREST and written through server-side pathways.

ALTER TABLE public.restaurant_menu_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_ingredient_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_ingredient_brand_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_editor_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.restaurant_menu_pages FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_menu_dishes FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_menu_ingredient_rows FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_menu_ingredient_brand_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_editor_locks FROM anon, authenticated;

GRANT SELECT ON TABLE public.restaurant_menu_pages TO anon, authenticated;
GRANT SELECT ON TABLE public.restaurant_menu_dishes TO anon, authenticated;
GRANT SELECT ON TABLE public.restaurant_menu_ingredient_rows TO anon, authenticated;
GRANT SELECT ON TABLE public.restaurant_menu_ingredient_brand_items TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_menu_pages'
      AND policyname = 'Allow read restaurant menu pages'
  ) THEN
    CREATE POLICY "Allow read restaurant menu pages"
      ON public.restaurant_menu_pages
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_menu_dishes'
      AND policyname = 'Allow read restaurant menu dishes'
  ) THEN
    CREATE POLICY "Allow read restaurant menu dishes"
      ON public.restaurant_menu_dishes
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_menu_ingredient_rows'
      AND policyname = 'Allow read restaurant menu ingredient rows'
  ) THEN
    CREATE POLICY "Allow read restaurant menu ingredient rows"
      ON public.restaurant_menu_ingredient_rows
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_menu_ingredient_brand_items'
      AND policyname = 'Allow read restaurant menu ingredient brand items'
  ) THEN
    CREATE POLICY "Allow read restaurant menu ingredient brand items"
      ON public.restaurant_menu_ingredient_brand_items
      FOR SELECT
      USING (TRUE);
  END IF;
END $$;
