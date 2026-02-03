CREATE TABLE IF NOT EXISTS public.manager_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_bundle_id text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS manager_device_tokens_user_token_idx
  ON public.manager_device_tokens (user_id, device_token);

CREATE INDEX IF NOT EXISTS manager_device_tokens_user_idx
  ON public.manager_device_tokens (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_manager_device_tokens_updated_at'
  ) THEN
    CREATE TRIGGER set_manager_device_tokens_updated_at
    BEFORE UPDATE ON public.manager_device_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.manager_device_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_device_tokens'
    AND policyname = 'Users can read own device tokens'
  ) THEN
    CREATE POLICY "Users can read own device tokens"
      ON public.manager_device_tokens
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_device_tokens'
    AND policyname = 'Users can insert own device tokens'
  ) THEN
    CREATE POLICY "Users can insert own device tokens"
      ON public.manager_device_tokens
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_device_tokens'
    AND policyname = 'Users can update own device tokens'
  ) THEN
    CREATE POLICY "Users can update own device tokens"
      ON public.manager_device_tokens
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_device_tokens'
    AND policyname = 'Users can delete own device tokens'
  ) THEN
    CREATE POLICY "Users can delete own device tokens"
      ON public.manager_device_tokens
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
