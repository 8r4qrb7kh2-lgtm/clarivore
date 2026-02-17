BEGIN;

-- Safety assertion: do not drop legacy manager access table if any row has not
-- already been migrated to canonical restaurant_managers.
DO $$
BEGIN
  IF to_regclass('public.manager_restaurant_access') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.manager_restaurant_access AS legacy
    LEFT JOIN public.restaurant_managers AS canonical
      ON canonical.user_id = legacy.user_id
     AND canonical.restaurant_id = legacy.restaurant_id
    WHERE legacy.user_id IS NOT NULL
      AND legacy.restaurant_id IS NOT NULL
      AND canonical.id IS NULL
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = 'Abort cleanup: manager_restaurant_access contains rows not present in restaurant_managers.';
  END IF;
END $$;

-- Safety assertion: do not drop legacy pending-save tables if any batch id
-- was not migrated into restaurant_write_batches.
DO $$
BEGIN
  IF to_regclass('public.editor_pending_save_batches') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.editor_pending_save_batches AS legacy
    LEFT JOIN public.restaurant_write_batches AS canonical
      ON canonical.id = legacy.id
    WHERE canonical.id IS NULL
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = 'Abort cleanup: editor_pending_save_batches contains rows not present in restaurant_write_batches.';
  END IF;

  IF to_regclass('public.editor_pending_save_batches_v2') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.editor_pending_save_batches_v2 AS legacy
    LEFT JOIN public.restaurant_write_batches AS canonical
      ON canonical.id = legacy.id
    WHERE canonical.id IS NULL
  ) THEN
    RAISE EXCEPTION
      USING MESSAGE = 'Abort cleanup: editor_pending_save_batches_v2 contains rows not present in restaurant_write_batches.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_household_user_ids();

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  DELETE FROM public.user_allergies WHERE user_id = auth.uid();
  DELETE FROM public.restaurant_managers WHERE user_id = auth.uid();
  DELETE FROM public.user_favorites WHERE user_id = auth.uid();
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- Drop child tables before parent tables to satisfy FK constraints.
DROP TABLE IF EXISTS public.editor_pending_save_rows;
DROP TABLE IF EXISTS public.editor_pending_save_rows_v2;
DROP TABLE IF EXISTS public.editor_pending_save_batches;
DROP TABLE IF EXISTS public.editor_pending_save_batches_v2;

DROP TABLE IF EXISTS public.household_invites;
DROP TABLE IF EXISTS public.household_members;
DROP TABLE IF EXISTS public.shopping_list;
DROP TABLE IF EXISTS public.weekly_plans;
DROP TABLE IF EXISTS public.recipes;
DROP TABLE IF EXISTS public.households;

DROP TABLE IF EXISTS public.issue_reports;
DROP TABLE IF EXISTS public.manager_invitations;
DROP TABLE IF EXISTS public.manager_restaurant_access;

COMMIT;
