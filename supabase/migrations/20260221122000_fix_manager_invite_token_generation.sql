-- Hotfix: avoid gen_random_bytes dependency for invite token generation.

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
        -- regenerate token and retry
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

REVOKE ALL ON FUNCTION public.create_manager_invite(uuid[], text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_manager_invite(uuid[], text, integer)
  TO authenticated, service_role;
