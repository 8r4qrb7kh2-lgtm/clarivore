import { createClient } from "@supabase/supabase-js";

let warnedAboutInsecureTls = false;

function asText(value) {
  return String(value ?? "").trim();
}

function toBooleanFlag(value) {
  const normalized = asText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldAllowSelfSignedTls() {
  return toBooleanFlag(process.env.SUPABASE_TLS_ALLOW_SELF_SIGNED);
}

function maybeRelaxSupabaseTls() {
  if (!shouldAllowSelfSignedTls()) return;

  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  if (!warnedAboutInsecureTls) {
    warnedAboutInsecureTls = true;
    console.warn(
      "[supabase-server] TLS certificate verification is disabled because SUPABASE_TLS_ALLOW_SELF_SIGNED is enabled.",
    );
  }
}

export function getSupabaseServerUrl() {
  return asText(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function createSupabaseServerClient(supabaseKey, options = {}) {
  const supabaseUrl = getSupabaseServerUrl();
  const key = asText(supabaseKey);
  if (!supabaseUrl || !key) return null;

  maybeRelaxSupabaseTls();

  return createClient(supabaseUrl, key, {
    ...options,
    auth: {
      persistSession: false,
      ...(options?.auth || {}),
    },
  });
}

export function createSupabaseServiceRoleClient(options = {}) {
  const serviceRoleKey = asText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceRoleKey) return null;

  return createSupabaseServerClient(serviceRoleKey, {
    ...options,
    auth: {
      autoRefreshToken: false,
      ...(options?.auth || {}),
    },
  });
}

export function createSupabaseAuthClient(options = {}) {
  const authKey = asText(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  if (!authKey) return null;

  return createSupabaseServerClient(authKey, options);
}
