import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readEnvFile(filePath) {
  const output = {};
  if (!fs.existsSync(filePath)) return output;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  });
  return output;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const envFromFiles = {
  ...readEnvFile(path.join(root, '.env')),
  ...readEnvFile(path.join(root, '.env.local')),
};

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  envFromFiles.NEXT_PUBLIC_SUPABASE_URL ||
  envFromFiles.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  envFromFiles.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  envFromFiles.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  envFromFiles.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('missing env');
  process.exit(1);
}

const supabase = createClient(url, key);
const { data, error } = await supabase
  .from('restaurants')
  .select('id,slug,name,menu_image,menu_images,overlays')
  .eq('slug', 'demo-menu')
  .maybeSingle();

if (error) {
  console.error(error);
  process.exit(1);
}

function summarizeTallOverlays(overlays) {
  const list = Array.isArray(overlays) ? overlays : [];
  const byPage = {};
  const samples = [];
  let tallCount = 0;
  let maxRatio = 0;

  for (const overlay of list) {
    const pos = overlay?.position && typeof overlay.position === 'object' ? overlay.position : null;
    const x1 = Number(pos?.x ?? overlay?.x);
    const y1 = Number(pos?.y ?? overlay?.y);
    const x2 = Number(pos?.x2 ?? overlay?.x2);
    const y2 = Number(pos?.y2 ?? overlay?.y2);
    const width = Number.isFinite(x1) && Number.isFinite(x2) ? Math.max(0, x2 - x1) : 0;
    const height = Number.isFinite(y1) && Number.isFinite(y2) ? Math.max(0, y2 - y1) : 0;
    const ratio = width > 0 ? height / width : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(ratio) && width <= 0 && height <= 0) continue;
    maxRatio = Math.max(maxRatio, ratio);

    const page = Number.isFinite(Number(overlay?.page)) ? Number(overlay.page) : 0;
    if (!byPage[page]) byPage[page] = { total: 0, tall: 0 };
    byPage[page].total += 1;

    if (ratio >= 5) {
      tallCount += 1;
      byPage[page].tall += 1;
      if (samples.length < 6) {
        samples.push({
          id: overlay?.id || null,
          name: overlay?.name || '',
          page,
          width,
          height,
          ratio,
          y2,
        });
      }
    }
  }

  return {
    count: list.length,
    tallCount,
    maxRatio,
    byPage,
    samples,
  };
}

const legacyOverlaySummary = summarizeTallOverlays(data?.overlays);
const firstOverlay = Array.isArray(data?.overlays) && data.overlays.length ? data.overlays[0] : null;

console.log(JSON.stringify({
  id: data?.id,
  slug: data?.slug,
  name: data?.name,
  menu_image_prefix: typeof data?.menu_image === 'string' ? data.menu_image.slice(0, 96) : '',
  menu_image_length: typeof data?.menu_image === 'string' ? data.menu_image.length : 0,
  menu_images_count: Array.isArray(data?.menu_images) ? data.menu_images.length : 0,
  overlay_count: Array.isArray(data?.overlays) ? data.overlays.length : 0,
  overlay_first_keys: firstOverlay ? Object.keys(firstOverlay) : [],
  overlay_first_sample: firstOverlay,
  overlay_summary: legacyOverlaySummary,
  menu_images: Array.isArray(data?.menu_images)
    ? data.menu_images.slice(0, 6).map((value) => ({
        prefix: typeof value === 'string' ? value.slice(0, 96) : '',
        length: typeof value === 'string' ? value.length : 0,
      }))
    : [],
}, null, 2));
