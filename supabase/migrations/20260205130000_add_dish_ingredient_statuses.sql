CREATE TABLE IF NOT EXISTS public.dish_ingredient_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  dish_name text NOT NULL,
  row_index integer NOT NULL,
  row_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, dish_name, row_index)
);

CREATE INDEX IF NOT EXISTS dish_ingredient_rows_restaurant_idx
  ON public.dish_ingredient_rows (restaurant_id);

CREATE INDEX IF NOT EXISTS dish_ingredient_rows_dish_idx
  ON public.dish_ingredient_rows (restaurant_id, dish_name);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_dish_ingredient_rows_updated_at'
  ) THEN
    CREATE TRIGGER set_dish_ingredient_rows_updated_at
    BEFORE UPDATE ON public.dish_ingredient_rows
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.dish_ingredient_allergens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_row_id uuid NOT NULL REFERENCES public.dish_ingredient_rows(id) ON DELETE CASCADE,
  allergen_id uuid NOT NULL REFERENCES public.allergens(id) ON DELETE CASCADE,
  is_violation boolean NOT NULL DEFAULT false,
  is_cross_contamination boolean NOT NULL DEFAULT false,
  is_removable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingredient_row_id, allergen_id)
);

CREATE INDEX IF NOT EXISTS dish_ingredient_allergens_row_idx
  ON public.dish_ingredient_allergens (ingredient_row_id);

CREATE INDEX IF NOT EXISTS dish_ingredient_allergens_allergen_idx
  ON public.dish_ingredient_allergens (allergen_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_dish_ingredient_allergens_updated_at'
  ) THEN
    CREATE TRIGGER set_dish_ingredient_allergens_updated_at
    BEFORE UPDATE ON public.dish_ingredient_allergens
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.dish_ingredient_diets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_row_id uuid NOT NULL REFERENCES public.dish_ingredient_rows(id) ON DELETE CASCADE,
  diet_id uuid NOT NULL REFERENCES public.diets(id) ON DELETE CASCADE,
  is_violation boolean NOT NULL DEFAULT false,
  is_cross_contamination boolean NOT NULL DEFAULT false,
  is_removable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingredient_row_id, diet_id)
);

CREATE INDEX IF NOT EXISTS dish_ingredient_diets_row_idx
  ON public.dish_ingredient_diets (ingredient_row_id);

CREATE INDEX IF NOT EXISTS dish_ingredient_diets_diet_idx
  ON public.dish_ingredient_diets (diet_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_dish_ingredient_diets_updated_at'
  ) THEN
    CREATE TRIGGER set_dish_ingredient_diets_updated_at
    BEFORE UPDATE ON public.dish_ingredient_diets
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.dish_ingredient_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_ingredient_allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_ingredient_diets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_rows'
    AND policyname = 'Allow read dish ingredient rows'
  ) THEN
    CREATE POLICY "Allow read dish ingredient rows"
      ON public.dish_ingredient_rows
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_rows'
    AND policyname = 'Authenticated can insert dish ingredient rows'
  ) THEN
    CREATE POLICY "Authenticated can insert dish ingredient rows"
      ON public.dish_ingredient_rows
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_rows'
    AND policyname = 'Authenticated can update dish ingredient rows'
  ) THEN
    CREATE POLICY "Authenticated can update dish ingredient rows"
      ON public.dish_ingredient_rows
      FOR UPDATE
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_rows'
    AND policyname = 'Authenticated can delete dish ingredient rows'
  ) THEN
    CREATE POLICY "Authenticated can delete dish ingredient rows"
      ON public.dish_ingredient_rows
      FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_allergens'
    AND policyname = 'Allow read dish ingredient allergens'
  ) THEN
    CREATE POLICY "Allow read dish ingredient allergens"
      ON public.dish_ingredient_allergens
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_allergens'
    AND policyname = 'Authenticated can insert dish ingredient allergens'
  ) THEN
    CREATE POLICY "Authenticated can insert dish ingredient allergens"
      ON public.dish_ingredient_allergens
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_allergens'
    AND policyname = 'Authenticated can update dish ingredient allergens'
  ) THEN
    CREATE POLICY "Authenticated can update dish ingredient allergens"
      ON public.dish_ingredient_allergens
      FOR UPDATE
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_allergens'
    AND policyname = 'Authenticated can delete dish ingredient allergens'
  ) THEN
    CREATE POLICY "Authenticated can delete dish ingredient allergens"
      ON public.dish_ingredient_allergens
      FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_diets'
    AND policyname = 'Allow read dish ingredient diets'
  ) THEN
    CREATE POLICY "Allow read dish ingredient diets"
      ON public.dish_ingredient_diets
      FOR SELECT
      USING (TRUE);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_diets'
    AND policyname = 'Authenticated can insert dish ingredient diets'
  ) THEN
    CREATE POLICY "Authenticated can insert dish ingredient diets"
      ON public.dish_ingredient_diets
      FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_diets'
    AND policyname = 'Authenticated can update dish ingredient diets'
  ) THEN
    CREATE POLICY "Authenticated can update dish ingredient diets"
      ON public.dish_ingredient_diets
      FOR UPDATE
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dish_ingredient_diets'
    AND policyname = 'Authenticated can delete dish ingredient diets'
  ) THEN
    CREATE POLICY "Authenticated can delete dish ingredient diets"
      ON public.dish_ingredient_diets
      FOR DELETE
      USING (auth.role() = 'authenticated');
  END IF;
END $$;

CREATE OR REPLACE VIEW public.dish_allergen_statuses AS
SELECT
  rows.restaurant_id,
  rows.dish_name,
  allergens.allergen_id,
  bool_or(allergens.is_violation) AS has_violation,
  bool_or(allergens.is_cross_contamination) AS has_cross_contamination
FROM public.dish_ingredient_rows AS rows
JOIN public.dish_ingredient_allergens AS allergens
  ON allergens.ingredient_row_id = rows.id
GROUP BY rows.restaurant_id, rows.dish_name, allergens.allergen_id;

CREATE OR REPLACE VIEW public.dish_diet_statuses AS
SELECT
  rows.restaurant_id,
  rows.dish_name,
  diets.diet_id,
  bool_or(diets.is_violation) AS has_violation,
  bool_or(diets.is_cross_contamination) AS has_cross_contamination
FROM public.dish_ingredient_rows AS rows
JOIN public.dish_ingredient_diets AS diets
  ON diets.ingredient_row_id = rows.id
GROUP BY rows.restaurant_id, rows.dish_name, diets.diet_id;

GRANT SELECT ON public.dish_allergen_statuses TO anon, authenticated;
GRANT SELECT ON public.dish_diet_statuses TO anon, authenticated;
