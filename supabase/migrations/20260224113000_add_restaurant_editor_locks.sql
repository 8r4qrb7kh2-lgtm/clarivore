CREATE TABLE IF NOT EXISTS public.restaurant_editor_locks (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  holder_name text NOT NULL DEFAULT '',
  holder_email text NOT NULL DEFAULT '',
  holder_instance text NOT NULL DEFAULT '',
  acquired_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_editor_locks_expires_at
  ON public.restaurant_editor_locks (expires_at);

CREATE INDEX IF NOT EXISTS idx_restaurant_editor_locks_user_id
  ON public.restaurant_editor_locks (user_id);
