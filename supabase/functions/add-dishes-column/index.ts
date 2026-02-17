import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Ensure menu_snapshots.dishes_json exists as jsonb.
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE OR REPLACE FUNCTION public.__clarivore_try_parse_jsonb(input_text text)
        RETURNS jsonb
        LANGUAGE plpgsql
        IMMUTABLE
        AS $$
        BEGIN
          IF input_text IS NULL OR btrim(input_text) = '' THEN
            RETURN '[]'::jsonb;
          END IF;
          RETURN input_text::jsonb;
        EXCEPTION
          WHEN OTHERS THEN
            RETURN to_jsonb(input_text);
        END;
        $$;

        DO $do$
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
              ADD COLUMN IF NOT EXISTS dishes_json_jsonb jsonb;

            UPDATE public.menu_snapshots
            SET dishes_json_jsonb = COALESCE(
              public.__clarivore_try_parse_jsonb(dishes_json),
              '[]'::jsonb
            );

            ALTER TABLE public.menu_snapshots
              DROP COLUMN dishes_json;

            ALTER TABLE public.menu_snapshots
              RENAME COLUMN dishes_json_jsonb TO dishes_json;
          ELSE
            ALTER TABLE public.menu_snapshots
              ADD COLUMN IF NOT EXISTS dishes_json jsonb;
          END IF;

          ALTER TABLE public.menu_snapshots
            ALTER COLUMN dishes_json SET DEFAULT '[]'::jsonb;
        END;
        $do$;

        DROP FUNCTION IF EXISTS public.__clarivore_try_parse_jsonb(text);
      `
    })

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, message: 'Column is now JSONB' }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  }
})
