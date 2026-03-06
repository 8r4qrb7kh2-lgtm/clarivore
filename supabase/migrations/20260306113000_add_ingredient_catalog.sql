CREATE TABLE IF NOT EXISTS public.ingredient_catalog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  lookup_terms text[] NOT NULL DEFAULT '{}'::text[],
  lookup_count integer NOT NULL DEFAULT 0,
  allergens text[] NOT NULL DEFAULT '{}'::text[],
  diets text[] NOT NULL DEFAULT '{}'::text[],
  is_ready boolean NOT NULL DEFAULT false,
  seed_source text NOT NULL DEFAULT 'corpus_seed',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingredient_catalog_entries_ready_idx
ON public.ingredient_catalog_entries (is_ready);

CREATE INDEX IF NOT EXISTS ingredient_catalog_entries_lookup_terms_gin_idx
ON public.ingredient_catalog_entries
USING gin (lookup_terms);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'set_updated_at'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'set_ingredient_catalog_entries_updated_at'
    ) THEN
      CREATE TRIGGER set_ingredient_catalog_entries_updated_at
      BEFORE UPDATE ON public.ingredient_catalog_entries
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
    END IF;
  END IF;
END
$$;

ALTER TABLE public.ingredient_catalog_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ingredient_catalog_entries'
      AND policyname = 'Allow read ingredient catalog entries'
  ) THEN
    CREATE POLICY "Allow read ingredient catalog entries"
    ON public.ingredient_catalog_entries
    FOR SELECT
    USING (true);
  END IF;
END
$$;
