import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { analyzeMenuImageWithLocalEngine } from '../app/api/menu-image-analysis/localRepositionEngine.mjs';

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

function asText(value) {
  return String(value || '').trim();
}

function parseJpegDimensionsFromDataUrl(dataUrl) {
  const source = asText(dataUrl);
  const match = source.match(/^data:image\/jpeg(?:;[^,]*)?;base64,(.*)$/i);
  if (!match) return null;
  const base64 = match[1];
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;

    const length = (bytes[offset] << 8) + bytes[offset + 1];
    if (!Number.isFinite(length) || length < 2 || offset + length > bytes.length) break;

    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 7 >= bytes.length) return null;
      const height = (bytes[offset + 3] << 8) + bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) + bytes[offset + 6];
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    offset += length;
  }

  return null;
}

function withFixtureReplayBypassed(dataUrl) {
  const source = asText(dataUrl);
  const match = source.match(/^(data:image\/jpeg;base64,)(.*)$/i);
  if (!match) return source;
  const prefix = match[1];
  const payload = match[2];
  try {
    const bytes = Buffer.from(payload, 'base64');
    if (!bytes.length) return source;
    const next = Buffer.concat([bytes, Buffer.from([0])]);
    return `${prefix}${next.toString('base64')}`;
  } catch {
    return source;
  }
}

function summarizeDishes(label, dishes) {
  const list = Array.isArray(dishes) ? dishes : [];
  const rows = list.map((dish) => {
    const name = asText(dish?.name || dish?.id);
    const x = Number(dish?.x || 0);
    const y = Number(dish?.y || 0);
    const w = Number(dish?.w || 0);
    const h = Number(dish?.h || 0);
    const aspect = w > 0 ? h / w : Infinity;
    return { name, x, y, w, h, aspect };
  });

  const tall = rows
    .filter((row) => Number.isFinite(row.aspect) && row.aspect >= 5)
    .sort((a, b) => b.aspect - a.aspect)
    .slice(0, 8);

  console.log(`\n=== ${label} ===`);
  console.log(`dish_count: ${rows.length}`);
  console.log(`tall_boxes(>=5x h/w): ${tall.length}`);
  tall.forEach((row, index) => {
    console.log(`${index + 1}. ${row.name} | x=${row.x.toFixed(1)} y=${row.y.toFixed(1)} w=${row.w.toFixed(1)} h=${row.h.toFixed(1)} aspect=${row.aspect.toFixed(2)}`);
  });
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const env = {
  ...readEnvFile(path.join(root, '.env')),
  ...readEnvFile(path.join(root, '.env.local')),
  ...process.env,
};

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase runtime config');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const { data: restaurant, error } = await supabase
  .from('restaurants')
  .select('slug,menu_image,menu_images,overlays')
  .eq('slug', 'demo-menu')
  .maybeSingle();

if (error || !restaurant) {
  console.error('Failed to load demo-menu', error || 'not found');
  process.exit(1);
}

const imageList = Array.isArray(restaurant.menu_images) && restaurant.menu_images.length
  ? restaurant.menu_images
  : [restaurant.menu_image];

for (let pageIndex = 0; pageIndex < imageList.length; pageIndex += 1) {
  const imageData = asText(imageList[pageIndex]);
  if (!imageData) continue;
  const jpegDims = parseJpegDimensionsFromDataUrl(imageData);
  const bypassedImageData = withFixtureReplayBypassed(imageData);

  console.log(`\n################ page ${pageIndex + 1} ################`);
  console.log('image_data_length:', imageData.length);
  console.log('jpeg_dims:', jpegDims);

  const replayResult = await analyzeMenuImageWithLocalEngine({
    body: {
      mode: 'detect',
      imageData,
      imageWidth: jpegDims?.width,
      imageHeight: jpegDims?.height,
      pageIndex,
    },
    env,
  });

  const liveResult = await analyzeMenuImageWithLocalEngine({
    body: {
      mode: 'detect',
      imageData: bypassedImageData,
      imageWidth: jpegDims?.width,
      imageHeight: jpegDims?.height,
      pageIndex,
    },
    env,
  });

  summarizeDishes('fixture_or_replay_result', replayResult?.dishes);
  summarizeDishes('live_engine_result', liveResult?.dishes);

  console.log('replay_diagnostics:', replayResult?.diagnostics || null);
  console.log('live_diagnostics:', liveResult?.diagnostics || null);
}
