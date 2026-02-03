CREATE TABLE IF NOT EXISTS public.manager_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS manager_push_subscriptions_user_endpoint_idx
  ON public.manager_push_subscriptions (user_id, endpoint);

CREATE INDEX IF NOT EXISTS manager_push_subscriptions_user_idx
  ON public.manager_push_subscriptions (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_manager_push_subscriptions_updated_at'
  ) THEN
    CREATE TRIGGER set_manager_push_subscriptions_updated_at
    BEFORE UPDATE ON public.manager_push_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.manager_push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_push_subscriptions'
    AND policyname = 'Users can read own push subscriptions'
  ) THEN
    CREATE POLICY "Users can read own push subscriptions"
      ON public.manager_push_subscriptions
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_push_subscriptions'
    AND policyname = 'Users can insert own push subscriptions'
  ) THEN
    CREATE POLICY "Users can insert own push subscriptions"
      ON public.manager_push_subscriptions
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_push_subscriptions'
    AND policyname = 'Users can update own push subscriptions'
  ) THEN
    CREATE POLICY "Users can update own push subscriptions"
      ON public.manager_push_subscriptions
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manager_push_subscriptions'
    AND policyname = 'Users can delete own push subscriptions'
  ) THEN
    CREATE POLICY "Users can delete own push subscriptions"
      ON public.manager_push_subscriptions
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
