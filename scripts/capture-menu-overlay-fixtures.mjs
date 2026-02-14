#!/usr/bin/env node

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const WORKTREE_ROOT = "/Users/mattdavis/.cursor/worktrees/clarivore-main/9J1NT";
const FIXTURE_DIR = path.join(
  WORKTREE_ROOT,
  "docs",
  "parity-snapshots",
  "menu-overlay-fixtures",
);

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseArgs(argv) {
  const args = {
    slug: asText(process.env.VERIFY_RESTAURANT_SLUG) || "demo-menu",
    maxPages: 3,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--slug=")) {
      args.slug = asText(arg.split("=").slice(1).join("="));
      return;
    }
    if (arg.startsWith("--max-pages=")) {
      const parsed = Number(arg.split("=").slice(1).join("="));
      if (Number.isFinite(parsed) && parsed > 0) {
        args.maxPages = Math.max(1, Math.floor(parsed));
      }
    }
  });

  return args;
}

function readSupabaseRuntime() {
  const supabaseUrl =
    asText(process.env.SUPABASE_URL) || asText(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey =
    asText(process.env.SUPABASE_ANON_KEY) || asText(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase runtime config: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY are required.",
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

function sha256(value) {
  return crypto.createHash("sha256").update(asText(value)).digest("hex");
}

function sanitizeOverlay(entry) {
  const name = asText(entry?.id || entry?.name || entry?.dishName || entry?.title);
  if (!name) return null;

  const x = Number(entry?.x);
  const y = Number(entry?.y);
  const w = Number(entry?.w);
  const h = Number(entry?.h);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h) ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }

  return {
    id: name,
    name,
    x,
    y,
    w,
    h,
  };
}

function dedupeByName(items) {
  const out = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const token = normalizeToken(item?.name || item?.id);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(item);
  });
  return out;
}

async function fetchRestaurant({ supabaseUrl, supabaseAnonKey, slug }) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/restaurants?select=id,slug,name,menu_images&slug=eq.${encodeURIComponent(slug)}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : [];
  } catch {
    payload = [];
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch restaurant (${response.status}): ${asText(payload?.message) || asText(text)}`,
    );
  }

  const row = Array.isArray(payload) ? payload[0] : null;
  if (!row) {
    throw new Error(`Restaurant not found for slug: ${slug}`);
  }

  const menuImages = Array.isArray(row?.menu_images)
    ? row.menu_images.filter(Boolean)
    : [];

  if (!menuImages.length) {
    throw new Error(`Restaurant ${slug} has no menu_images.`);
  }

  return {
    id: asText(row.id),
    slug: asText(row.slug),
    name: asText(row.name),
    menuImages,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callRepositionOverlays({ supabaseUrl, supabaseAnonKey, payload }) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/reposition-overlays`;

  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text };
      }

      if (!response.ok) {
        const message =
          asText(parsed?.error?.message) || asText(parsed?.error) || asText(text);
        if (response.status >= 500 && response.status <= 599 && attempt < maxAttempts) {
          await sleep(attempt * 750);
          continue;
        }
        throw new Error(`reposition-overlays failed (${response.status}): ${message}`);
      }

      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await sleep(attempt * 750);
    }
  }

  throw lastError || new Error("reposition-overlays failed.");
}

function buildExpected(payload) {
  const updatedOverlays = dedupeByName(
    (Array.isArray(payload?.updatedOverlays) ? payload.updatedOverlays : [])
      .map(sanitizeOverlay)
      .filter(Boolean),
  );
  const newOverlays = dedupeByName(
    (Array.isArray(payload?.newOverlays) ? payload.newOverlays : [])
      .map(sanitizeOverlay)
      .filter(Boolean),
  );

  return {
    updatedOverlays,
    newOverlays,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { supabaseUrl, supabaseAnonKey } = readSupabaseRuntime();

  if (process.cwd() !== WORKTREE_ROOT) {
    throw new Error(`Run from ${WORKTREE_ROOT}. Current cwd: ${process.cwd()}`);
  }

  const restaurant = await fetchRestaurant({
    supabaseUrl,
    supabaseAnonKey,
    slug: args.slug,
  });

  const pagesToCapture = restaurant.menuImages.slice(0, args.maxPages);
  const fixtures = [];

  for (let pageIndex = 0; pageIndex < pagesToCapture.length; pageIndex += 1) {
    const image = pagesToCapture[pageIndex];
    const newImageSha256 = sha256(image);

    const discoveryPayload = {
      oldImageUrl: null,
      newImageUrl: image,
      overlays: [],
      imageWidth: 1000,
      imageHeight: 1000,
      pageIndex,
    };

    const discoveryResponse = await callRepositionOverlays({
      supabaseUrl,
      supabaseAnonKey,
      payload: discoveryPayload,
    });

    const discoveryExpected = buildExpected(discoveryResponse);
    fixtures.push({
      id: `discovery-page-${pageIndex + 1}`,
      mode: "discovery",
      source: {
        oldPageIndex: null,
        newPageIndex: pageIndex,
      },
      checksums: {
        oldImageSha256: null,
        newImageSha256,
      },
      imageWidth: 1000,
      imageHeight: 1000,
      pageIndex,
      overlayHints: [],
      expected: discoveryExpected,
    });

    const identityHints = [
      ...discoveryExpected.updatedOverlays,
      ...discoveryExpected.newOverlays,
    ];

    const remapPayload = {
      oldImageUrl: image,
      newImageUrl: image,
      overlays: identityHints,
      imageWidth: 1000,
      imageHeight: 1000,
      pageIndex,
    };

    const remapResponse = await callRepositionOverlays({
      supabaseUrl,
      supabaseAnonKey,
      payload: remapPayload,
    });

    fixtures.push({
      id: `remap-identity-page-${pageIndex + 1}`,
      mode: "remap",
      source: {
        oldPageIndex: pageIndex,
        newPageIndex: pageIndex,
      },
      checksums: {
        oldImageSha256: newImageSha256,
        newImageSha256,
      },
      imageWidth: 1000,
      imageHeight: 1000,
      pageIndex,
      overlayHints: identityHints,
      expected: buildExpected(remapResponse),
    });
  }

  const firstDiscoveryWithHints = fixtures.find(
    (fixture) => fixture.mode === "discovery" && fixture.expected.newOverlays.length > 0,
  );
  if (firstDiscoveryWithHints && pagesToCapture.length > 1) {
    const oldPageIndex = Number(firstDiscoveryWithHints.source.newPageIndex);
    const newPageIndex = pagesToCapture.length - 1 === oldPageIndex ? 0 : pagesToCapture.length - 1;

    const oldImage = pagesToCapture[oldPageIndex];
    const newImage = pagesToCapture[newPageIndex];

    const crossPayload = {
      oldImageUrl: oldImage,
      newImageUrl: newImage,
      overlays: firstDiscoveryWithHints.expected.newOverlays,
      imageWidth: 1000,
      imageHeight: 1000,
      pageIndex: newPageIndex,
    };

    const crossResponse = await callRepositionOverlays({
      supabaseUrl,
      supabaseAnonKey,
      payload: crossPayload,
    });

    fixtures.push({
      id: `remap-cross-page-${oldPageIndex + 1}-to-${newPageIndex + 1}`,
      mode: "remap",
      source: {
        oldPageIndex,
        newPageIndex,
      },
      checksums: {
        oldImageSha256: sha256(oldImage),
        newImageSha256: sha256(newImage),
      },
      imageWidth: 1000,
      imageHeight: 1000,
      pageIndex: newPageIndex,
      overlayHints: firstDiscoveryWithHints.expected.newOverlays,
      expected: buildExpected(crossResponse),
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceEngine: "legacy-reposition-overlays",
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
      capturedPageCount: pagesToCapture.length,
      totalPageCount: restaurant.menuImages.length,
    },
    fixtures,
  };

  await fsp.mkdir(FIXTURE_DIR, { recursive: true });
  const outputPath = path.join(FIXTURE_DIR, `${restaurant.slug}.json`);
  await fsp.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        success: true,
        outputPath,
        fixtureCount: fixtures.length,
        discoveryFixtures: fixtures.filter((item) => item.mode === "discovery").length,
        remapFixtures: fixtures.filter((item) => item.mode === "remap").length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
