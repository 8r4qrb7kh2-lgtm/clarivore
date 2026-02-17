CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = '42501';
  END IF;

  -- Remove/neutralize direct NO ACTION references before deleting auth.users.
  DELETE FROM public.restaurant_direct_messages
  WHERE sender_id = current_user_id;

  UPDATE public.manager_invites
  SET
    created_by = CASE WHEN created_by = current_user_id THEN NULL ELSE created_by END,
    used_by = CASE WHEN used_by = current_user_id THEN NULL ELSE used_by END
  WHERE created_by = current_user_id
     OR used_by = current_user_id;

  DELETE FROM public.user_allergies WHERE user_id = current_user_id;
  DELETE FROM public.restaurant_managers WHERE user_id = current_user_id;
  DELETE FROM public.user_favorites WHERE user_id = current_user_id;
  DELETE FROM auth.users WHERE id = current_user_id;
END;
$$;
