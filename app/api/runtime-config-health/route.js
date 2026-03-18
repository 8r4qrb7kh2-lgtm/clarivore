import { corsJson, corsOptions } from "../_shared/cors";
import { getDefaultShadowPrimaryProvider, resolveProviderMode } from "../../lib/server/ai/modelCatalog";

export const runtime = "nodejs";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY|OPENAI_API_KEY",
  "GOOGLE_VISION_API_KEY",
  "CLARIVORE_SYSTEM_WRITE_KEY",
];
const EDITOR_REQUIRED = ["DATABASE_URL"];

function asText(value) {
  return String(value ?? "").trim();
}

function hasEnv(name) {
  return Boolean(asText(process.env[name]));
}

function providerHealth(provider) {
  if (provider === "openai") {
    return {
      provider,
      ok: hasEnv("OPENAI_API_KEY"),
      missing: hasEnv("OPENAI_API_KEY") ? [] : ["OPENAI_API_KEY"],
    };
  }

  return {
    provider,
    ok: hasEnv("ANTHROPIC_API_KEY"),
    missing: hasEnv("ANTHROPIC_API_KEY") ? [] : ["ANTHROPIC_API_KEY"],
  };
}

function editorHealth() {
  return {
    ok: hasEnv("DATABASE_URL"),
    missing: hasEnv("DATABASE_URL") ? [] : ["DATABASE_URL"],
    required: EDITOR_REQUIRED,
  };
}

function readRuntimeConfigHealth() {
  const missing = [];
  const providerMode = resolveProviderMode(process.env);
  const shadowPrimaryProvider = getDefaultShadowPrimaryProvider(process.env);
  const editor = editorHealth();

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

  if (!hasEnv("ANTHROPIC_API_KEY") && !hasEnv("OPENAI_API_KEY")) {
    missing.push("ANTHROPIC_API_KEY|OPENAI_API_KEY");
  }

  if (!hasEnv("GOOGLE_VISION_API_KEY")) {
    missing.push("GOOGLE_VISION_API_KEY");
  }

  if (!hasEnv("CLARIVORE_SYSTEM_WRITE_KEY")) {
    missing.push("CLARIVORE_SYSTEM_WRITE_KEY");
  }

  return {
    ok:
      missing.length === 0 &&
      (providerMode === "shadow"
        ? providerHealth("anthropic").ok && providerHealth("openai").ok
        : providerHealth(providerMode).ok),
    missing,
    required: REQUIRED,
    ai: {
      providerMode,
      shadowPrimaryProvider,
      anthropic: providerHealth("anthropic"),
      openai: providerHealth("openai"),
    },
    editor,
  };
}

export function OPTIONS() {
  return corsOptions();
}

export function GET() {
  return corsJson(readRuntimeConfigHealth(), { status: 200 });
}
