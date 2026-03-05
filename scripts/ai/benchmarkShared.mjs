import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKTREE_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

export function asText(value) {
  return String(value ?? "").trim();
}

export function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizePhrase(value) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePromptClassToken(value) {
  return asText(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function nowRunId(prefix = "ai-bench") {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `${prefix}-${stamp}`;
}

export function resolveOutDir(runId) {
  return path.join(WORKTREE_ROOT, "out", "ai-benchmarks", asText(runId));
}

export async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function writeJsonLines(filePath, rows) {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : [])
    .map((row) => JSON.stringify(row))
    .join("\n");
  await fsp.writeFile(filePath, body ? `${body}\n` : "", "utf8");
}

export function readEnvFile(filePath) {
  const output = {};
  if (!fs.existsSync(filePath)) return output;
  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = asText(line);
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  });
  return output;
}

export function loadLocalEnv() {
  const merged = {
    ...readEnvFile(path.join(WORKTREE_ROOT, ".env")),
    ...readEnvFile(path.join(WORKTREE_ROOT, ".env.local")),
  };

  Object.entries(merged).forEach(([key, value]) => {
    if (!asText(process.env[key])) {
      process.env[key] = value;
    }
  });

  return merged;
}

export function sha1(value) {
  return crypto.createHash("sha1").update(String(value ?? "")).digest("hex");
}

export function stableSample(items, limit, keyFn = (value) => value) {
  const safeItems = Array.isArray(items) ? items.slice() : [];
  const maxItems = Math.max(0, Math.floor(Number(limit) || 0));
  if (!maxItems || safeItems.length <= maxItems) return safeItems;

  return safeItems
    .map((item) => ({
      item,
      key: sha1(typeof keyFn === "function" ? keyFn(item) : JSON.stringify(item)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .slice(0, maxItems)
    .map((entry) => entry.item);
}

export function dedupeByToken(items, readValue = (value) => value) {
  const seen = new Set();
  const output = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const token = normalizeToken(typeof readValue === "function" ? readValue(item) : item);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(item);
  });
  return output;
}

export function splitIngredientText(value) {
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeStringList(values) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });
  return output;
}

export function slugify(value, fallback = "case") {
  const safe = asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

export function buildCaseId(promptClass, seed) {
  return `${slugify(promptClass)}-${sha1(seed).slice(0, 12)}`;
}

export async function fetchBinaryAsDataUrl(url, fallbackMime = "image/jpeg") {
  const safeUrl = asText(url);
  if (!safeUrl) return "";
  const response = await fetch(safeUrl, { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${safeUrl} (${response.status}).`);
  }
  const contentType = asText(response.headers.get("content-type")).split(";")[0] || fallbackMime;
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

export function joinTranscriptLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => asText(line))
    .filter(Boolean)
    .join("\n");
}

export function parseArgs(argv) {
  const args = {};
  (Array.isArray(argv) ? argv : []).forEach((arg) => {
    const safe = asText(arg);
    if (!safe.startsWith("--")) return;
    const separator = safe.indexOf("=");
    if (separator < 0) {
      args[safe.slice(2)] = "true";
      return;
    }
    args[safe.slice(2, separator)] = safe.slice(separator + 1);
  });
  return args;
}

export function readIntArg(args, key, fallback) {
  const value = Number.parseInt(asText(args?.[key]), 10);
  return Number.isFinite(value) ? value : fallback;
}

export function readBooleanArg(args, key, fallback = false) {
  const value = asText(args?.[key]).toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

export function readStringArg(args, key, fallback = "") {
  const value = asText(args?.[key]);
  return value || fallback;
}

export function buildModelOverrideEnv(promptClass, provider, model, baseEnv = process.env) {
  const promptToken = normalizePromptClassToken(promptClass);
  const env = { ...(baseEnv || {}) };
  if (provider === "openai") {
    env[`OPENAI_MODEL_${promptToken}`] = asText(model);
  } else {
    env[`ANTHROPIC_MODEL_${promptToken}`] = asText(model);
  }
  return env;
}

export function tokenizeWords(value) {
  return normalizePhrase(value)
    .split(/\s+/)
    .filter(Boolean);
}

export function levenshtein(left, right) {
  const a = Array.from(asText(left));
  const b = Array.from(asText(right));
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array(b.length + 1);
  const next = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        prev[j] + 1,
        next[j - 1] + 1,
        prev[j - 1] + substitution,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = next[j];
    }
  }

  return prev[b.length];
}

export function parseJsonObjectText(value) {
  const text = asText(value);
  if (!text) return null;

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(asText(fenced[1]));
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) candidates.push(asText(objectMatch[0]));

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      // continue
    }
  }

  return null;
}

export function parseJsonArrayText(value) {
  const text = asText(value);
  if (!text) return [];

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(asText(fenced[1]));
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) candidates.push(asText(arrayMatch[0]));

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.dishes) ? parsed.dishes : [];
    } catch {
      // continue
    }
  }

  return [];
}
