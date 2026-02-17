-- Maintenance-window cutover: consolidate write paths, normalize column types, and quarantine legacy surfaces.

CREATE OR REPLACE FUNCTION public.try_parse_jsonb(input_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF input_text IS NULL OR btrim(input_text) = '' THEN
    RETURN NULL;
  END IF;

  RETURN input_text::jsonb;
EXCEPTION
  WHEN OTHERS THEN
    RETURN to_jsonb(input_text);
END;
$$;

-- Canonical manager linkage backfill.
INSERT INTO public.restaurant_managers (
  id,
  user_id,
  restaurant_id,
  created_at
)
SELECT
  gen_random_uuid(),
  mra.user_id,
  mra.restaurant_id,
  COALESCE(mra.granted_at, now())
FROM public.manager_restaurant_access AS mra
LEFT JOIN public.restaurant_managers AS rm
  ON rm.user_id = mra.user_id
 AND rm.restaurant_id = mra.restaurant_id
WHERE mra.user_id IS NOT NULL
  AND mra.restaurant_id IS NOT NULL
  AND rm.id IS NULL;

DELETE FROM public.restaurant_managers
WHERE user_id IS NULL
   OR restaurant_id IS NULL;

ALTER TABLE public.restaurant_managers
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN restaurant_id SET NOT NULL;

-- Invite model consolidation: migrate any legacy rows into manager_invites.
INSERT INTO public.manager_invites (
  token,
  restaurant_ids,
  entry_page,
  created_at,
  expires_at,
  used_at,
  used_by,
  created_by,
  is_active
)
SELECT
  LEFT(mi.token, 64),
  ARRAY[mi.restaurant_id],
  'home',
  COALESCE(mi.created_at, now()),
  COALESCE(mi.created_at, now()) + INTERVAL '48 hours',
  mi.used_at,
  mi.used_by,
  NULL,
  CASE
    WHEN COALESCE(mi.used, false) OR mi.used_at IS NOT NULL THEN false
    ELSE true
  END
FROM public.manager_invitations AS mi
WHERE mi.restaurant_id IS NOT NULL
  AND COALESCE(btrim(mi.token), '') <> ''
ON CONFLICT (token) DO NOTHING;

-- Stage/write consolidation from pending-save batches into restaurant_write_*.
ALTER TABLE IF EXISTS public.editor_pending_save_batches
  ADD COLUMN IF NOT EXISTS migrated_to_write_gateway_at timestamptz;

ALTER TABLE IF EXISTS public.editor_pending_save_batches_v2
  ADD COLUMN IF NOT EXISTS migrated_to_write_gateway_at timestamptz;

INSERT INTO public.restaurant_write_batches (
  id,
  scope_type,
  scope_key,
  restaurant_id,
  created_by,
  author,
  status,
  base_write_version,
  review_summary,
  created_at,
  updated_at,
  applied_at,
  discarded_at
)
SELECT
  src.id,
  'RESTAURANT',
  src.restaurant_id::text,
  src.restaurant_id,
  COALESCE(src.created_by, gen_random_uuid()),
  src.author,
  CASE
    WHEN src.status IN ('pending', 'applied', 'discarded') THEN src.status
    ELSE 'failed'
  END,
  COALESCE(r.write_version, 0),
  jsonb_build_object(
    'migratedFrom', src.source_table,
    'rowCount', COALESCE(src.row_count, 0),
    'stateHash', COALESCE(src.state_hash, '')
  ),
  COALESCE(src.created_at, now()),
  COALESCE(src.updated_at, now()),
  src.applied_at,
  CASE
    WHEN src.status = 'discarded' THEN COALESCE(src.updated_at, now())
    ELSE NULL
  END
FROM (
  SELECT
    b.id,
    b.restaurant_id,
    b.created_by,
    b.author,
    b.status,
    b.state_hash,
    b.row_count,
    b.created_at,
    b.updated_at,
    b.applied_at,
    b.staged_overlays,
    b.staged_menu_image,
    b.staged_menu_images,
    b.change_payload,
    'editor_pending_save_batches'::text AS source_table
  FROM public.editor_pending_save_batches AS b

  UNION ALL

  SELECT
    b2.id,
    b2.restaurant_id,
    b2.created_by,
    b2.author,
    b2.status,
    b2.state_hash,
    b2.row_count,
    b2.created_at,
    b2.updated_at,
    b2.applied_at,
    b2.staged_overlays,
    b2.staged_menu_image,
    b2.staged_menu_images,
    b2.change_payload,
    'editor_pending_save_batches_v2'::text AS source_table
  FROM public.editor_pending_save_batches_v2 AS b2
) AS src
LEFT JOIN public.restaurants AS r
  ON r.id = src.restaurant_id
WHERE src.restaurant_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurant_write_ops (
  id,
  batch_id,
  sort_order,
  operation_type,
  operation_payload,
  summary,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  src.id,
  0,
  'MENU_STATE_REPLACE',
  jsonb_build_object(
    'overlays', COALESCE(src.staged_overlays, '[]'::jsonb),
    'menuImage', src.staged_menu_image,
    'menuImages', COALESCE(src.staged_menu_images, '[]'::jsonb),
    'stateHash', COALESCE(src.state_hash, ''),
    'changePayload', COALESCE(src.change_payload, '{}'::jsonb),
    'rowCount', COALESCE(src.row_count, 0),
    'rows', '[]'::jsonb,
    'migratedFrom', src.source_table
  ),
  COALESCE(NULLIF(btrim(src.author), ''), 'Migrated pending save batch'),
  COALESCE(src.created_at, now()),
  COALESCE(src.updated_at, now())
FROM (
  SELECT
    b.id,
    b.author,
    b.created_at,
    b.updated_at,
    b.state_hash,
    b.row_count,
    b.staged_overlays,
    b.staged_menu_image,
    b.staged_menu_images,
    b.change_payload,
    'editor_pending_save_batches'::text AS source_table
  FROM public.editor_pending_save_batches AS b

  UNION ALL

  SELECT
    b2.id,
    b2.author,
    b2.created_at,
    b2.updated_at,
    b2.state_hash,
    b2.row_count,
    b2.staged_overlays,
    b2.staged_menu_image,
    b2.staged_menu_images,
    b2.change_payload,
    'editor_pending_save_batches_v2'::text AS source_table
  FROM public.editor_pending_save_batches_v2 AS b2
) AS src
WHERE EXISTS (
    SELECT 1
    FROM public.restaurant_write_batches AS wb
    WHERE wb.id = src.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.restaurant_write_ops AS wo
    WHERE wo.batch_id = src.id
      AND wo.operation_type = 'MENU_STATE_REPLACE'
  );

UPDATE public.editor_pending_save_batches AS b
SET migrated_to_write_gateway_at = now()
WHERE migrated_to_write_gateway_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.restaurant_write_batches AS wb
    WHERE wb.id = b.id
  );

UPDATE public.editor_pending_save_batches_v2 AS b2
SET migrated_to_write_gateway_at = now()
WHERE migrated_to_write_gateway_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.restaurant_write_batches AS wb
    WHERE wb.id = b2.id
  );

-- Normalize menu_snapshots.dishes_json from text -> jsonb when needed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'menu_snapshots'
      AND column_name = 'dishes_json'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE public.menu_snapshots
      ADD COLUMN dishes_json_new jsonb;

    UPDATE public.menu_snapshots
    SET dishes_json_new = COALESCE(public.try_parse_jsonb(dishes_json), '[]'::jsonb);

    ALTER TABLE public.menu_snapshots
      DROP COLUMN dishes_json;

    ALTER TABLE public.menu_snapshots
      RENAME COLUMN dishes_json_new TO dishes_json;

    ALTER TABLE public.menu_snapshots
      ALTER COLUMN dishes_json SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Normalize change_logs.changes from text -> jsonb when needed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'change_logs'
      AND column_name = 'changes'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE public.change_logs
      ADD COLUMN changes_new jsonb;

    UPDATE public.change_logs
    SET changes_new = public.try_parse_jsonb(changes);

    ALTER TABLE public.change_logs
      DROP COLUMN changes;

    ALTER TABLE public.change_logs
      RENAME COLUMN changes_new TO changes;
  END IF;
END $$;

-- Remove duplicate indexes.
DROP INDEX IF EXISTS public.idx_editor_locks_restaurant;
DROP INDEX IF EXISTS public.idx_feedback_email_queue_token;
DROP INDEX IF EXISTS public.idx_manager_invitations_token;
DROP INDEX IF EXISTS public.idx_manager_invites_token;

-- Add FK-supporting indexes identified by audit.
DO $$
BEGIN
  IF to_regclass('public.accommodation_requests') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_accommodation_requests_manager_reviewed_by
      ON public.accommodation_requests (manager_reviewed_by);
  END IF;

  IF to_regclass('public.change_logs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_change_logs_restaurant_id
      ON public.change_logs (restaurant_id);
  END IF;

  IF to_regclass('public.diet_allergen_conflicts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_diet_allergen_conflicts_allergen_id
      ON public.diet_allergen_conflicts (allergen_id);
  END IF;

  IF to_regclass('public.editor_locks') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_editor_locks_user_id
      ON public.editor_locks (user_id);
  END IF;

  IF to_regclass('public.household_invites') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_household_invites_created_by
      ON public.household_invites (created_by);
    CREATE INDEX IF NOT EXISTS idx_household_invites_household_id
      ON public.household_invites (household_id);
    CREATE INDEX IF NOT EXISTS idx_household_invites_used_by
      ON public.household_invites (used_by);
  END IF;

  IF to_regclass('public.household_members') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_household_members_user_id
      ON public.household_members (user_id);
  END IF;

  IF to_regclass('public.issue_reports') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_issue_reports_user_id
      ON public.issue_reports (user_id);
  END IF;

  IF to_regclass('public.manager_invitations') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_manager_invitations_used_by
      ON public.manager_invitations (used_by);
  END IF;

  IF to_regclass('public.manager_invites') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_manager_invites_created_by
      ON public.manager_invites (created_by);
    CREATE INDEX IF NOT EXISTS idx_manager_invites_used_by
      ON public.manager_invites (used_by);
  END IF;

  IF to_regclass('public.manager_restaurant_access') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_manager_restaurant_access_granted_by
      ON public.manager_restaurant_access (granted_by);
  END IF;

  IF to_regclass('public.order_feedback') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_order_feedback_restaurant_id
      ON public.order_feedback (restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_order_feedback_user_id
      ON public.order_feedback (user_id);
  END IF;

  IF to_regclass('public.recipes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_recipes_user_id
      ON public.recipes (user_id);
  END IF;

  IF to_regclass('public.restaurant_direct_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_restaurant_direct_messages_sender_id
      ON public.restaurant_direct_messages (sender_id);
  END IF;

  IF to_regclass('public.restaurant_write_batches') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_restaurant_write_batches_restaurant_id
      ON public.restaurant_write_batches (restaurant_id);
  END IF;

  IF to_regclass('public.shopping_list') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_shopping_list_household_id
      ON public.shopping_list (household_id);
    CREATE INDEX IF NOT EXISTS idx_shopping_list_user_id
      ON public.shopping_list (user_id);
  END IF;

  IF to_regclass('public.user_favorites') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_user_favorites_restaurant_id
      ON public.user_favorites (restaurant_id);
  END IF;

  IF to_regclass('public.weekly_plans') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_weekly_plans_household_id
      ON public.weekly_plans (household_id);
  END IF;
END $$;

-- Quarantine deprecated tables by ensuring RLS and removing client grants/policies.
DO $$
DECLARE
  table_name text;
  policy_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'manager_invitations',
    'manager_restaurant_access',
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
    'issue_reports'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

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

    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM anon, authenticated',
      table_name
    );

    EXECUTE format(
      'COMMENT ON TABLE public.%I IS %L',
      table_name,
      'DEPRECATED: quarantined during maintenance cutover; scheduled for removal after 30-day no-access window.'
    );
  END LOOP;
END $$;
