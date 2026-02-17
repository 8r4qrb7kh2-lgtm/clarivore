import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_VISION_API_KEY",
  "CLARIVORE_SYSTEM_WRITE_KEY",
];

function asText(value) {
  return String(value ?? "").trim();
}

function hasEnv(name) {
  return Boolean(asText(process.env[name]));
}

function readRuntimeConfigHealth() {
  const missing = [];

  if (!hasEnv("NEXT_PUBLIC_SUPABASE_URL")) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!hasEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (!hasEnv("SUPABASE_URL") && !hasEnv("NEXT_PUBLIC_SUPABASE_URL")) {
    missing.push("SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!hasEnv("SUPABASE_ANON_KEY") && !hasEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    missing.push("SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (!hasEnv("ANTHROPIC_API_KEY")) {
    missing.push("ANTHROPIC_API_KEY");
  }

  if (!hasEnv("GOOGLE_VISION_API_KEY")) {
    missing.push("GOOGLE_VISION_API_KEY");
  }

  if (!hasEnv("CLARIVORE_SYSTEM_WRITE_KEY")) {
    missing.push("CLARIVORE_SYSTEM_WRITE_KEY");
  }

  return {
    ok: missing.length === 0,
    missing,
    required: REQUIRED,
  };
}

export function OPTIONS() {
  return corsOptions();
}

export function GET() {
  return corsJson(readRuntimeConfigHealth(), { status: 200 });
}
