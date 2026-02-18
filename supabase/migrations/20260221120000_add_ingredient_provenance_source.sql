DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'ingredient_provenance_source'
  ) THEN
    CREATE TYPE public.ingredient_provenance_source AS ENUM (
      'smart_detected',
      'manual_override'
    );
  END IF;
END $$;

ALTER TABLE public.dish_ingredient_allergens
  ADD COLUMN IF NOT EXISTS source public.ingredient_provenance_source;

ALTER TABLE public.dish_ingredient_diets
  ADD COLUMN IF NOT EXISTS source public.ingredient_provenance_source;

UPDATE public.dish_ingredient_allergens
SET source = 'smart_detected'::public.ingredient_provenance_source
WHERE source IS NULL;

UPDATE public.dish_ingredient_diets
SET source = 'smart_detected'::public.ingredient_provenance_source
WHERE source IS NULL;

ALTER TABLE public.dish_ingredient_allergens
  ALTER COLUMN source SET DEFAULT 'smart_detected'::public.ingredient_provenance_source;

ALTER TABLE public.dish_ingredient_diets
  ALTER COLUMN source SET DEFAULT 'smart_detected'::public.ingredient_provenance_source;

ALTER TABLE public.dish_ingredient_allergens
  ALTER COLUMN source SET NOT NULL;

ALTER TABLE public.dish_ingredient_diets
  ALTER COLUMN source SET NOT NULL;
