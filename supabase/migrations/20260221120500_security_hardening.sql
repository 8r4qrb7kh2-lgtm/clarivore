-- Security-first hardening for admin/manager authorization and legacy table lock-down.

CREATE TABLE IF NOT EXISTS public.app_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_admins_granted_by
  ON public.app_admins (granted_by);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins admins
    WHERE admins.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

INSERT INTO public.app_admins (user_id, granted_by)
SELECT u.id, u.id
FROM auth.users AS u
WHERE lower(COALESCE(u.email, '')) = lower('matt.29.ds@gmail.com')
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_manager_invite(
  p_restaurant_ids uuid[],
  p_entry_page text DEFAULT 'home',
  p_expires_in_hours integer DEFAULT 48
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_token text;
  v_row public.manager_invites%ROWTYPE;
  v_restaurant_ids uuid[];
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT restaurant_id
      FROM unnest(COALESCE(p_restaurant_ids, ARRAY[]::uuid[])) AS restaurant_id
      WHERE restaurant_id IS NOT NULL
    ),
    ARRAY[]::uuid[]
  )
  INTO v_restaurant_ids;

  IF COALESCE(array_length(v_restaurant_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one restaurant id is required.';
  END IF;

  LOOP
    v_token := md5(random()::text || clock_timestamp()::text || COALESCE(auth.uid()::text, ''));
    BEGIN
      INSERT INTO public.manager_invites (
        token,
        restaurant_ids,
        entry_page,
        created_by,
        expires_at,
        is_active
      )
      VALUES (
        v_token,
        v_restaurant_ids,
        COALESCE(NULLIF(btrim(p_entry_page), ''), 'home'),
        auth.uid(),
        now() + make_interval(hours => GREATEST(COALESCE(p_expires_in_hours, 48), 1)),
        true
      )
      RETURNING * INTO v_row;

      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        -- regenerate token
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'token', v_row.token,
    'restaurant_ids', v_row.restaurant_ids,
    'entry_page', v_row.entry_page,
    'expires_at', v_row.expires_at,
    'created_at', v_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_manager_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_token text := btrim(COALESCE(p_token, ''));
  v_invite public.manager_invites%ROWTYPE;
  v_restaurant_id uuid;
  v_granted_count integer := 0;
  v_row_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'unauthenticated',
      'message', 'Authentication required.'
    );
  END IF;

  IF v_token = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_token',
      'message', 'Invite token is required.'
    );
  END IF;

  SELECT *
  INTO v_invite
  FROM public.manager_invites
  WHERE token = v_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_token',
      'message', 'Invite not found.'
    );
  END IF;

  IF COALESCE(v_invite.is_active, false) = false THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'revoked',
      'message', 'Invite is inactive.'
    );
  END IF;

  IF v_invite.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'used',
      'message', 'Invite has already been used.'
    );
  END IF;

  IF v_invite.expires_at <= now() THEN
    UPDATE public.manager_invites
    SET is_active = false
    WHERE id = v_invite.id;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'expired',
      'message', 'Invite has expired.'
    );
  END IF;

  FOREACH v_restaurant_id IN ARRAY COALESCE(v_invite.restaurant_ids, ARRAY[]::uuid[])
  LOOP
    INSERT INTO public.restaurant_managers (
      user_id,
      restaurant_id,
      created_at
    )
    VALUES (
      v_user_id,
      v_restaurant_id,
      now()
    )
    ON CONFLICT (restaurant_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count > 0 THEN
      v_granted_count := v_granted_count + 1;
    END IF;
  END LOOP;

  UPDATE public.manager_invites
  SET
    used_at = now(),
    used_by = v_user_id,
    is_active = false
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ok',
    'message', 'Invite consumed.',
    'restaurant_ids', v_invite.restaurant_ids,
    'granted_count', v_granted_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_manager_access(
  p_user_id uuid,
  p_restaurant_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_changed integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Both p_user_id and p_restaurant_id are required.';
  END IF;

  IF auth.role() <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_enabled, false) THEN
    INSERT INTO public.restaurant_managers (
      user_id,
      restaurant_id,
      created_at
    )
    VALUES (
      p_user_id,
      p_restaurant_id,
      now()
    )
    ON CONFLICT (restaurant_id, user_id) DO NOTHING;

    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSE
    DELETE FROM public.restaurant_managers
    WHERE user_id = p_user_id
      AND restaurant_id = p_restaurant_id;

    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'enabled', COALESCE(p_enabled, false),
    'changed', (v_changed > 0),
    'user_id', p_user_id,
    'restaurant_id', p_restaurant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_manager_invite(uuid[], text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_manager_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_manager_access(uuid, uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_manager_invite(uuid[], text, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_manager_invite(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_manager_access(uuid, uuid, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  DELETE FROM public.user_allergies WHERE user_id = auth.uid();
  DELETE FROM public.restaurant_managers WHERE user_id = auth.uid();
  DELETE FROM public.manager_restaurant_access WHERE user_id = auth.uid();
  DELETE FROM public.user_favorites WHERE user_id = auth.uid();
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

DO $$
DECLARE
  table_name text;
  policy_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'app_admins',
    'manager_invites',
    'manager_invitations',
    'manager_restaurant_access',
    'restaurant_managers',
    'restaurants',
    'dish_interactions',
    'tablet_orders',
    'accommodation_requests',
    'restaurant_direct_messages',
    'restaurant_direct_message_reads'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      CONTINUE;
    END IF;

    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_record.policyname,
        table_name
      );
    END LOOP;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.app_admins') IS NOT NULL THEN
    CREATE POLICY "Admins can read app admins"
      ON public.app_admins
      FOR SELECT
      TO authenticated
      USING (public.is_admin() OR auth.uid() = user_id);

    CREATE POLICY "Admins can manage app admins"
      ON public.app_admins
      FOR ALL
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.manager_invites') IS NOT NULL THEN
    CREATE POLICY "Manager invites readable when active"
      ON public.manager_invites
      FOR SELECT
      TO public
      USING (is_active = true AND used_at IS NULL AND expires_at > now());

    CREATE POLICY "Admins manage manager invites"
      ON public.manager_invites
      FOR ALL
      TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.restaurant_managers') IS NOT NULL THEN
    CREATE POLICY "Users can read own manager rows"
      ON public.restaurant_managers
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);

    CREATE POLICY "Admins can read manager rows"
      ON public.restaurant_managers
      FOR SELECT
      TO authenticated
      USING (public.is_admin());

    CREATE POLICY "Admins can insert manager rows"
      ON public.restaurant_managers
      FOR INSERT
      TO authenticated
      WITH CHECK (public.is_admin());

    CREATE POLICY "Admins can delete manager rows"
      ON public.restaurant_managers
      FOR DELETE
      TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.restaurants') IS NOT NULL THEN
    CREATE POLICY "Public can read restaurants"
      ON public.restaurants
      FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.dish_interactions') IS NOT NULL THEN
    CREATE POLICY "Users and managers can read interactions"
      ON public.dish_interactions
      FOR SELECT
      TO authenticated
      USING (
        auth.uid() = user_id
        OR public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = dish_interactions.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );

    CREATE POLICY "Users can insert own interactions"
      ON public.dish_interactions
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.tablet_orders') IS NOT NULL THEN
    CREATE POLICY "Anon can insert tablet orders"
      ON public.tablet_orders
      FOR INSERT
      TO anon
      WITH CHECK (true);

    CREATE POLICY "Authenticated can insert tablet orders"
      ON public.tablet_orders
      FOR INSERT
      TO authenticated
      WITH CHECK (true);

    CREATE POLICY "Managers can read tablet orders"
      ON public.tablet_orders
      FOR SELECT
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.user_id = auth.uid()
            AND rm.restaurant_id = tablet_orders.restaurant_id
        )
      );

    CREATE POLICY "Managers can update tablet orders"
      ON public.tablet_orders
      FOR UPDATE
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.user_id = auth.uid()
            AND rm.restaurant_id = tablet_orders.restaurant_id
        )
      )
      WITH CHECK (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.user_id = auth.uid()
            AND rm.restaurant_id = tablet_orders.restaurant_id
        )
      );

    CREATE POLICY "Managers can delete tablet orders"
      ON public.tablet_orders
      FOR DELETE
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.user_id = auth.uid()
            AND rm.restaurant_id = tablet_orders.restaurant_id
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.accommodation_requests') IS NOT NULL THEN
    CREATE POLICY "Users can read own accommodation requests"
      ON public.accommodation_requests
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);

    CREATE POLICY "Users can insert own accommodation requests"
      ON public.accommodation_requests
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "Users can delete own accommodation requests"
      ON public.accommodation_requests
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);

    CREATE POLICY "Managers can read accommodation requests"
      ON public.accommodation_requests
      FOR SELECT
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = accommodation_requests.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );

    CREATE POLICY "Managers can update accommodation requests"
      ON public.accommodation_requests
      FOR UPDATE
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = accommodation_requests.restaurant_id
            AND rm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = accommodation_requests.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.restaurant_direct_messages') IS NOT NULL THEN
    CREATE POLICY "Managers can read restaurant direct messages"
      ON public.restaurant_direct_messages
      FOR SELECT
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = restaurant_direct_messages.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );

    CREATE POLICY "Managers can insert restaurant direct messages"
      ON public.restaurant_direct_messages
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = restaurant_direct_messages.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.restaurant_direct_message_reads') IS NOT NULL THEN
    CREATE POLICY "Managers can read restaurant direct message reads"
      ON public.restaurant_direct_message_reads
      FOR SELECT
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = restaurant_direct_message_reads.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );

    CREATE POLICY "Managers can insert restaurant direct message reads"
      ON public.restaurant_direct_message_reads
      FOR INSERT
      TO authenticated
      WITH CHECK (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = restaurant_direct_message_reads.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );

    CREATE POLICY "Managers can update restaurant direct message reads"
      ON public.restaurant_direct_message_reads
      FOR UPDATE
      TO authenticated
      USING (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = restaurant_direct_message_reads.restaurant_id
            AND rm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        public.is_admin()
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_managers AS rm
          WHERE rm.restaurant_id = restaurant_direct_message_reads.restaurant_id
            AND rm.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'editor_pending_save_batches_v2',
    'editor_pending_save_rows_v2',
    'households',
    'issue_reports'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name text;
  policy_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'manager_invitations',
    'manager_restaurant_access',
    'editor_pending_save_batches_v2',
    'editor_pending_save_rows_v2',
    'households',
    'issue_reports'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      CONTINUE;
    END IF;

    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_record.policyname,
        table_name
      );
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'app_admins',
    'manager_invites',
    'manager_invitations',
    'manager_restaurant_access',
    'restaurant_managers',
    'editor_pending_save_batches',
    'editor_pending_save_rows',
    'editor_pending_save_batches_v2',
    'editor_pending_save_rows_v2',
    'households',
    'household_members',
    'household_invites',
    'shopping_list',
    'weekly_plans',
    'recipes',
    'issue_reports',
    'restaurant_write_batches',
    'restaurant_write_ops'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.%I FROM anon, authenticated',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.manager_invites') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.manager_invites TO anon, authenticated;
  END IF;

  IF to_regclass('public.restaurant_managers') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.restaurant_managers TO authenticated;
  END IF;

  IF to_regclass('public.app_admins') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.app_admins TO authenticated;
  END IF;
END $$;

COMMENT ON TABLE public.app_admins IS 'Canonical admin authority table for Clarivore application access control.';
