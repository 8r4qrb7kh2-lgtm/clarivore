-- Supabase-managed auth indexes are owned by the auth role. Keep this migration idempotent
-- and non-failing when run under the linked project role.
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP INDEX IF EXISTS auth.mfa_factors_user_id_idx';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping DROP INDEX auth.mfa_factors_user_id_idx: insufficient privilege';
  END;
END
$$;
