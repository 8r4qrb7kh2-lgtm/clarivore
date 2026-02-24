-- Harden public views and functions flagged by Security Advisor.
-- 1) Views exposed to API roles should use security_invoker semantics.
-- 2) Public functions should have an explicit search_path.

DO $$
BEGIN
  IF to_regclass('public.menu_changes') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.menu_changes SET (security_invoker = true)';
  END IF;

  IF to_regclass('public.dish_analytics') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.dish_analytics SET (security_invoker = true)';
  END IF;

  IF to_regclass('public.dish_allergen_statuses') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.dish_allergen_statuses SET (security_invoker = true)';
  END IF;

  IF to_regclass('public.dish_diet_statuses') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.dish_diet_statuses SET (security_invoker = true)';
  END IF;
END $$;

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, auth, extensions, pg_temp',
      fn.signature
    );
  END LOOP;
END $$;
