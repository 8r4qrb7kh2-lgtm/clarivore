CREATE TABLE IF NOT EXISTS public.restaurant_menu_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  page_index integer NOT NULL,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, page_index)
);

CREATE INDEX IF NOT EXISTS restaurant_menu_pages_restaurant_idx
  ON public.restaurant_menu_pages (restaurant_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at'
      AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_restaurant_menu_pages_updated_at'
  ) THEN
    CREATE TRIGGER set_restaurant_menu_pages_updated_at
    BEFORE UPDATE ON public.restaurant_menu_pages
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.restaurant_menu_dishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  dish_key text NOT NULL,
  dish_name text NOT NULL,
  page_index integer NOT NULL DEFAULT 0,
  x double precision NOT NULL DEFAULT 0,
  y double precision NOT NULL DEFAULT 0,
  w double precision NOT NULL DEFAULT 0,
  h double precision NOT NULL DEFAULT 0,
  dish_text text,
  description text,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  allergens text[] NOT NULL DEFAULT '{}'::text[],
  diets text[] NOT NULL DEFAULT '{}'::text[],
  cross_contamination_allergens text[] NOT NULL DEFAULT '{}'::text[],
  cross_contamination_diets text[] NOT NULL DEFAULT '{}'::text[],
  removable_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ingredients_blocking_diets_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, dish_key)
);

CREATE INDEX IF NOT EXISTS restaurant_menu_dishes_restaurant_idx
  ON public.restaurant_menu_dishes (restaurant_id);

CREATE INDEX IF NOT EXISTS restaurant_menu_dishes_restaurant_page_idx
  ON public.restaurant_menu_dishes (restaurant_id, page_index);

CREATE INDEX IF NOT EXISTS restaurant_menu_dishes_restaurant_name_idx
  ON public.restaurant_menu_dishes (restaurant_id, dish_name);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at'
      AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_restaurant_menu_dishes_updated_at'
  ) THEN
    CREATE TRIGGER set_restaurant_menu_dishes_updated_at
    BEFORE UPDATE ON public.restaurant_menu_dishes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.restaurant_menu_ingredient_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  dish_id uuid REFERENCES public.restaurant_menu_dishes(id) ON DELETE SET NULL,
  dish_name text NOT NULL,
  row_index integer NOT NULL,
  row_text text,
  applied_brand_item text,
  ingredient_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, dish_name, row_index)
);

CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_rows_restaurant_idx
  ON public.restaurant_menu_ingredient_rows (restaurant_id);

CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_rows_dish_idx
  ON public.restaurant_menu_ingredient_rows (dish_id);

CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_rows_restaurant_dish_idx
  ON public.restaurant_menu_ingredient_rows (restaurant_id, dish_name);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at'
      AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_restaurant_menu_ingredient_rows_updated_at'
  ) THEN
    CREATE TRIGGER set_restaurant_menu_ingredient_rows_updated_at
    BEFORE UPDATE ON public.restaurant_menu_ingredient_rows
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.restaurant_menu_ingredient_brand_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  ingredient_row_id uuid NOT NULL UNIQUE REFERENCES public.restaurant_menu_ingredient_rows(id) ON DELETE CASCADE,
  dish_name text NOT NULL,
  row_index integer NOT NULL,
  brand_name text NOT NULL,
  barcode text,
  brand_image text,
  ingredients_image text,
  image text,
  ingredient_list text,
  ingredients_list text[] NOT NULL DEFAULT '{}'::text[],
  allergens text[] NOT NULL DEFAULT '{}'::text[],
  cross_contamination_allergens text[] NOT NULL DEFAULT '{}'::text[],
  diets text[] NOT NULL DEFAULT '{}'::text[],
  cross_contamination_diets text[] NOT NULL DEFAULT '{}'::text[],
  brand_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_brand_items_restaurant_idx
  ON public.restaurant_menu_ingredient_brand_items (restaurant_id);

CREATE INDEX IF NOT EXISTS restaurant_menu_ingredient_brand_items_restaurant_dish_idx
  ON public.restaurant_menu_ingredient_brand_items (restaurant_id, dish_name);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at'
      AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_restaurant_menu_ingredient_brand_items_updated_at'
  ) THEN
    CREATE TRIGGER set_restaurant_menu_ingredient_brand_items_updated_at
    BEFORE UPDATE ON public.restaurant_menu_ingredient_brand_items
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.restaurant_menu_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_ingredient_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_ingredient_brand_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_pages'
      AND policyname = 'Allow read restaurant menu pages'
  ) THEN
    CREATE POLICY "Allow read restaurant menu pages"
      ON public.restaurant_menu_pages
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_pages'
      AND policyname = 'Authenticated can insert restaurant menu pages'
  ) THEN
    CREATE POLICY "Authenticated can insert restaurant menu pages"
      ON public.restaurant_menu_pages
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_pages'
      AND policyname = 'Authenticated can update restaurant menu pages'
  ) THEN
    CREATE POLICY "Authenticated can update restaurant menu pages"
      ON public.restaurant_menu_pages
      FOR UPDATE
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_pages'
      AND policyname = 'Authenticated can delete restaurant menu pages'
  ) THEN
    CREATE POLICY "Authenticated can delete restaurant menu pages"
      ON public.restaurant_menu_pages
      FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_dishes'
      AND policyname = 'Allow read restaurant menu dishes'
  ) THEN
    CREATE POLICY "Allow read restaurant menu dishes"
      ON public.restaurant_menu_dishes
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_dishes'
      AND policyname = 'Authenticated can insert restaurant menu dishes'
  ) THEN
    CREATE POLICY "Authenticated can insert restaurant menu dishes"
      ON public.restaurant_menu_dishes
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_dishes'
      AND policyname = 'Authenticated can update restaurant menu dishes'
  ) THEN
    CREATE POLICY "Authenticated can update restaurant menu dishes"
      ON public.restaurant_menu_dishes
      FOR UPDATE
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_dishes'
      AND policyname = 'Authenticated can delete restaurant menu dishes'
  ) THEN
    CREATE POLICY "Authenticated can delete restaurant menu dishes"
      ON public.restaurant_menu_dishes
      FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_rows'
      AND policyname = 'Allow read restaurant menu ingredient rows'
  ) THEN
    CREATE POLICY "Allow read restaurant menu ingredient rows"
      ON public.restaurant_menu_ingredient_rows
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_rows'
      AND policyname = 'Authenticated can insert restaurant menu ingredient rows'
  ) THEN
    CREATE POLICY "Authenticated can insert restaurant menu ingredient rows"
      ON public.restaurant_menu_ingredient_rows
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_rows'
      AND policyname = 'Authenticated can update restaurant menu ingredient rows'
  ) THEN
    CREATE POLICY "Authenticated can update restaurant menu ingredient rows"
      ON public.restaurant_menu_ingredient_rows
      FOR UPDATE
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_rows'
      AND policyname = 'Authenticated can delete restaurant menu ingredient rows'
  ) THEN
    CREATE POLICY "Authenticated can delete restaurant menu ingredient rows"
      ON public.restaurant_menu_ingredient_rows
      FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_brand_items'
      AND policyname = 'Allow read restaurant menu ingredient brand items'
  ) THEN
    CREATE POLICY "Allow read restaurant menu ingredient brand items"
      ON public.restaurant_menu_ingredient_brand_items
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_brand_items'
      AND policyname = 'Authenticated can insert restaurant menu ingredient brand items'
  ) THEN
    CREATE POLICY "Authenticated can insert restaurant menu ingredient brand items"
      ON public.restaurant_menu_ingredient_brand_items
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_brand_items'
      AND policyname = 'Authenticated can update restaurant menu ingredient brand items'
  ) THEN
    CREATE POLICY "Authenticated can update restaurant menu ingredient brand items"
      ON public.restaurant_menu_ingredient_brand_items
      FOR UPDATE
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'restaurant_menu_ingredient_brand_items'
      AND policyname = 'Authenticated can delete restaurant menu ingredient brand items'
  ) THEN
    CREATE POLICY "Authenticated can delete restaurant menu ingredient brand items"
      ON public.restaurant_menu_ingredient_brand_items
      FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

GRANT SELECT ON public.restaurant_menu_pages TO anon, authenticated;
GRANT SELECT ON public.restaurant_menu_dishes TO anon, authenticated;
GRANT SELECT ON public.restaurant_menu_ingredient_rows TO anon, authenticated;
GRANT SELECT ON public.restaurant_menu_ingredient_brand_items TO anon, authenticated;
