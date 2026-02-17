-- Single protected write flow for manager/admin restaurant mutations.

ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS write_version bigint;

UPDATE public.restaurants
SET write_version = 0
WHERE write_version IS NULL;

ALTER TABLE public.restaurants
ALTER COLUMN write_version SET DEFAULT 0;

ALTER TABLE public.restaurants
ALTER COLUMN write_version SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.restaurant_write_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  author text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'discarded', 'failed')),
  base_write_version bigint,
  review_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  discarded_at timestamptz
);

CREATE INDEX IF NOT EXISTS restaurant_write_batches_scope_idx
  ON public.restaurant_write_batches (scope_type, scope_key, created_by, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_write_batches_pending_scope_idx
  ON public.restaurant_write_batches (scope_type, scope_key, created_by)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.restaurant_write_ops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.restaurant_write_batches(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  operation_type text NOT NULL,
  operation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, operation_type)
);

CREATE INDEX IF NOT EXISTS restaurant_write_ops_batch_idx
  ON public.restaurant_write_ops (batch_id, sort_order, created_at);

CREATE OR REPLACE FUNCTION public.set_restaurant_write_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_restaurant_write_batches_updated_at ON public.restaurant_write_batches;
CREATE TRIGGER set_restaurant_write_batches_updated_at
BEFORE UPDATE ON public.restaurant_write_batches
FOR EACH ROW
EXECUTE FUNCTION public.set_restaurant_write_updated_at();

DROP TRIGGER IF EXISTS set_restaurant_write_ops_updated_at ON public.restaurant_write_ops;
CREATE TRIGGER set_restaurant_write_ops_updated_at
BEFORE UPDATE ON public.restaurant_write_ops
FOR EACH ROW
EXECUTE FUNCTION public.set_restaurant_write_updated_at();

ALTER TABLE public.restaurant_write_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_write_ops ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.editor_pending_save_batches') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.editor_pending_save_batches ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.editor_pending_save_rows') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.editor_pending_save_rows ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Drop write policies on protected business tables.
DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'restaurants',
        'dish_ingredient_rows',
        'dish_ingredient_allergens',
        'dish_ingredient_diets',
        'change_logs'
      )
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  END LOOP;
END $$;

-- Drop all policies on staging/gateway tables so clients cannot read/write them directly.
DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'editor_pending_save_batches',
        'editor_pending_save_rows',
        'restaurant_write_batches',
        'restaurant_write_ops'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  END LOOP;
END $$;

-- Explicitly remove known permissive policy if present.
DROP POLICY IF EXISTS "Allow authenticated users to update restaurants" ON public.restaurants;

-- Revoke direct DML from anon/authenticated; writes are gateway-only.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'restaurants',
    'dish_ingredient_rows',
    'dish_ingredient_allergens',
    'dish_ingredient_diets',
    'change_logs',
    'editor_pending_save_batches',
    'editor_pending_save_rows',
    'restaurant_write_batches',
    'restaurant_write_ops'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon, authenticated',
        table_name
      );
    END IF;
  END LOOP;
END $$;
