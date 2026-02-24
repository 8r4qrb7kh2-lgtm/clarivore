-- Remove unused local variable flagged by plpgsql_check in acquire_editor_lock(uuid,text,text,integer).

CREATE OR REPLACE FUNCTION public.acquire_editor_lock(
  p_restaurant_id uuid,
  p_user_email text,
  p_user_name text DEFAULT NULL::text,
  p_lock_timeout_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_existing_lock editor_locks%ROWTYPE;
  v_current_user_id UUID;
BEGIN
  v_current_user_id := auth.uid();

  IF v_current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_existing_lock
  FROM editor_locks
  WHERE restaurant_id = p_restaurant_id;

  IF FOUND THEN
    IF v_existing_lock.last_heartbeat < NOW() - (p_lock_timeout_seconds || ' seconds')::INTERVAL THEN
      DELETE FROM editor_locks WHERE id = v_existing_lock.id;
    ELSIF v_existing_lock.user_id = v_current_user_id THEN
      UPDATE editor_locks
      SET last_heartbeat = NOW()
      WHERE id = v_existing_lock.id;
      RETURN jsonb_build_object('success', true, 'message', 'Lock renewed');
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'locked', true,
        'locked_by_email', v_existing_lock.user_email,
        'locked_by_name', v_existing_lock.user_name,
        'locked_at', v_existing_lock.locked_at,
        'last_heartbeat', v_existing_lock.last_heartbeat
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO editor_locks (restaurant_id, user_id, user_email, user_name)
    VALUES (p_restaurant_id, v_current_user_id, p_user_email, p_user_name);
    RETURN jsonb_build_object('success', true, 'message', 'Lock acquired');
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing_lock
    FROM editor_locks
    WHERE restaurant_id = p_restaurant_id;

    RETURN jsonb_build_object(
      'success', false,
      'locked', true,
      'locked_by_email', v_existing_lock.user_email,
      'locked_by_name', v_existing_lock.user_name,
      'locked_at', v_existing_lock.locked_at,
      'last_heartbeat', v_existing_lock.last_heartbeat
    );
  END;
END;
$function$;
