CREATE TABLE IF NOT EXISTS public.editor_pending_save_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_by uuid,
  author text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'discarded')),
  state_hash text,
  staged_overlays jsonb NOT NULL DEFAULT '[]'::jsonb,
  staged_menu_image text,
  staged_menu_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS editor_pending_save_batches_restaurant_idx
  ON public.editor_pending_save_batches (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS editor_pending_save_batches_status_idx
  ON public.editor_pending_save_batches (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.editor_pending_save_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.editor_pending_save_batches(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  dish_name text,
  row_index integer,
  ingredient_name text,
  change_type text NOT NULL,
  field_key text,
  before_value jsonb,
  after_value jsonb,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_pending_save_rows_batch_idx
  ON public.editor_pending_save_rows (batch_id, sort_order, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_editor_pending_save_batches_updated_at'
  ) THEN
    CREATE TRIGGER set_editor_pending_save_batches_updated_at
    BEFORE UPDATE ON public.editor_pending_save_batches
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.editor_pending_save_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editor_pending_save_rows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'editor_pending_save_batches'
    AND policyname = 'Authenticated can manage pending save batches'
  ) THEN
    CREATE POLICY "Authenticated can manage pending save batches"
      ON public.editor_pending_save_batches
      FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'editor_pending_save_rows'
    AND policyname = 'Authenticated can manage pending save rows'
  ) THEN
    CREATE POLICY "Authenticated can manage pending save rows"
      ON public.editor_pending_save_rows
      FOR ALL
      USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;
