#!/usr/bin/env node

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const WORKTREE_ROOT = "/Users/mattdavis/.cursor/worktrees/clarivore-main/9J1NT";
const FIXTURE_DIR = path.join(
  WORKTREE_ROOT,
  "docs",
  "parity-snapshots",
  "menu-overlay-fixtures",
);
const REPORT_DIR = path.join(WORKTREE_ROOT, "docs", "parity-snapshots", "reports");
const IOU_THRESHOLD = 0.82;
const MAX_SIDE_DELTA_PX = 12;

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseArgs(argv) {
  const args = {
    slug: asText(process.env.VERIFY_RESTAURANT_SLUG) || "demo-menu",
    fixturePath: "",
    runId: `menu-overlay-parity-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
  };

  argv.forEach((arg) => {
    if (arg.startsWith("--slug=")) {
      args.slug = asText(arg.split("=").slice(1).join("="));
      return;
    }
    if (arg.startsWith("--fixture=")) {
      args.fixturePath = asText(arg.split("=").slice(1).join("="));
      return;
    }
    if (arg.startsWith("--run-id=")) {
      args.runId = asText(arg.split("=").slice(1).join("=")) || args.runId;
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

function overlayMap(items) {
  const map = new Map();
  dedupeByName((Array.isArray(items) ? items : []).map(sanitizeOverlay).filter(Boolean)).forEach(
    (item) => {
      const token = normalizeToken(item.name);
      if (!token || map.has(token)) return;
      map.set(token, item);
    },
  );
  return map;
}

function rectSides(rect) {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.w,
    bottom: rect.y + rect.h,
  };
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return width * height;
}

function rectArea(rect) {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function iou(a, b) {
  const inter = intersectionArea(a, b);
  if (inter <= 0) return 0;
  const union = rectArea(a) + rectArea(b) - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function perSideDelta(expected, actual) {
  const e = rectSides(expected);
  const a = rectSides(actual);
  return {
    left: Math.abs(e.left - a.left),
    top: Math.abs(e.top - a.top),
    right: Math.abs(e.right - a.right),
    bottom: Math.abs(e.bottom - a.bottom),
  };
}

function passesGeometry(expected, actual) {
  const overlap = iou(expected, actual);
  if (overlap >= IOU_THRESHOLD) {
    return {
      pass: true,
      reason: `iou>=${IOU_THRESHOLD}`,
      iou: overlap,
      sideDelta: perSideDelta(expected, actual),
    };
  }

  const sideDelta = perSideDelta(expected, actual);
  const sidePass =
    sideDelta.left <= MAX_SIDE_DELTA_PX &&
    sideDelta.top <= MAX_SIDE_DELTA_PX &&
    sideDelta.right <= MAX_SIDE_DELTA_PX &&
    sideDelta.bottom <= MAX_SIDE_DELTA_PX;

  return {
    pass: sidePass,
    reason: sidePass ? `side-delta<=${MAX_SIDE_DELTA_PX}` : "geometry-mismatch",
    iou: overlap,
    sideDelta,
  };
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

function resolveFixturePath(args) {
  if (args.fixturePath) {
    return path.isAbsolute(args.fixturePath)
      ? args.fixturePath
      : path.join(WORKTREE_ROOT, args.fixturePath);
  }
  return path.join(FIXTURE_DIR, `${args.slug}.json`);
}

function compareOverlaySets({ expected, actual, bucket, caseId }) {
  const findings = [];
  const expectedMap = overlayMap(expected);
  const actualMap = overlayMap(actual);

  const expectedTokens = new Set(expectedMap.keys());
  const actualTokens = new Set(actualMap.keys());

  const missing = [...expectedTokens].filter((token) => !actualTokens.has(token));
  const extra = [...actualTokens].filter((token) => !expectedTokens.has(token));

  if (missing.length || extra.length) {
    findings.push({
      type: "name-set-mismatch",
      bucket,
      caseId,
      missing,
      extra,
    });
  }

  [...expectedTokens]
    .filter((token) => actualTokens.has(token))
    .forEach((token) => {
      const expectedOverlay = expectedMap.get(token);
      const actualOverlay = actualMap.get(token);
      const geometry = passesGeometry(expectedOverlay, actualOverlay);
      if (!geometry.pass) {
        findings.push({
          type: "geometry-mismatch",
          bucket,
          caseId,
          token,
          name: expectedOverlay?.name || actualOverlay?.name || token,
          iou: geometry.iou,
          sideDelta: geometry.sideDelta,
          expected: expectedOverlay,
          actual: actualOverlay,
        });
      }
    });

  return findings;
}

function toReportMarkdown(report) {
  const lines = [];
  lines.push(`# Menu Overlay Engine Parity`);
  lines.push("");
  lines.push(`- Run ID: ${report.runId}`);
  lines.push(`- Restaurant: ${report.restaurant.slug}`);
  lines.push(`- Fixtures: ${report.summary.fixtureCount}`);
  lines.push(`- Passed: ${report.summary.passedCount}`);
  lines.push(`- Failed: ${report.summary.failedCount}`);
  lines.push(`- Verdict: ${report.summary.failedCount === 0 ? "PASS" : "FAIL"}`);
  lines.push("");

  report.cases.forEach((item) => {
    lines.push(`## ${item.id}`);
    lines.push(`- Mode: ${item.mode}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Message: ${item.message}`);
    if (item.findings.length) {
      lines.push("- Findings:");
      item.findings.forEach((finding) => {
        if (finding.type === "name-set-mismatch") {
          lines.push(
            `  - [${finding.bucket}] missing=${finding.missing.join(",") || "none"} extra=${finding.extra.join(",") || "none"}`,
          );
          return;
        }
        lines.push(
          `  - [${finding.bucket}] ${finding.name}: iou=${Number(finding.iou || 0).toFixed(3)} deltas=${JSON.stringify(finding.sideDelta)}`,
        );
      });
    }
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.cwd() !== WORKTREE_ROOT) {
    throw new Error(`Run from ${WORKTREE_ROOT}. Current cwd: ${process.cwd()}`);
  }

  const fixturePath = resolveFixturePath(args);
  const fixtureText = await fsp.readFile(fixturePath, "utf8");
  const fixtureDoc = JSON.parse(fixtureText);

  const fixtureSlug = asText(fixtureDoc?.restaurant?.slug) || args.slug;
  const fixtures = Array.isArray(fixtureDoc?.fixtures) ? fixtureDoc.fixtures : [];
  if (!fixtures.length) {
    throw new Error(`No fixtures found in ${fixturePath}`);
  }

  const engineModuleUrl = pathToFileURL(
    path.join(WORKTREE_ROOT, "app", "api", "menu-image-analysis", "localRepositionEngine.mjs"),
  ).href;
  const { analyzeMenuImageWithLocalEngine } = await import(engineModuleUrl);

  const { supabaseUrl, supabaseAnonKey } = readSupabaseRuntime();
  const restaurant = await fetchRestaurant({
    supabaseUrl,
    supabaseAnonKey,
    slug: fixtureSlug,
  });

  const report = {
    runId: args.runId,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    fixturePath,
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
    },
    cases: [],
    summary: {
      fixtureCount: fixtures.length,
      passedCount: 0,
      failedCount: 0,
    },
  };

  for (const fixture of fixtures) {
    const caseId = asText(fixture?.id) || "unnamed-fixture";
    const mode = asText(fixture?.mode) || "discovery";
    const source = fixture?.source && typeof fixture.source === "object" ? fixture.source : {};
    const oldPageIndex = Number.isFinite(Number(source.oldPageIndex))
      ? Math.floor(Number(source.oldPageIndex))
      : null;
    const newPageIndex = Number.isFinite(Number(source.newPageIndex))
      ? Math.floor(Number(source.newPageIndex))
      : 0;

    const oldImage =
      oldPageIndex !== null && oldPageIndex >= 0 && oldPageIndex < restaurant.menuImages.length
        ? restaurant.menuImages[oldPageIndex]
        : "";
    const newImage =
      newPageIndex >= 0 && newPageIndex < restaurant.menuImages.length
        ? restaurant.menuImages[newPageIndex]
        : "";

    const findings = [];

    if (!newImage) {
      findings.push({
        type: "fixture-input-error",
        caseId,
        detail: `Missing new image for page index ${newPageIndex}`,
      });
    }

    const expectedOldSha = asText(fixture?.checksums?.oldImageSha256);
    const expectedNewSha = asText(fixture?.checksums?.newImageSha256);
    const actualOldSha = oldImage ? sha256(oldImage) : "";
    const actualNewSha = newImage ? sha256(newImage) : "";

    if (expectedOldSha && expectedOldSha !== actualOldSha) {
      findings.push({
        type: "checksum-mismatch",
        caseId,
        detail: `Old image checksum mismatch (${expectedOldSha} != ${actualOldSha})`,
      });
    }

    if (expectedNewSha && expectedNewSha !== actualNewSha) {
      findings.push({
        type: "checksum-mismatch",
        caseId,
        detail: `New image checksum mismatch (${expectedNewSha} != ${actualNewSha})`,
      });
    }

    let localResult = null;
    if (!findings.length) {
      const body =
        mode === "remap"
          ? {
              mode: "remap",
              oldImageData: oldImage,
              newImageData: newImage,
              overlays: Array.isArray(fixture?.overlayHints) ? fixture.overlayHints : [],
              imageWidth: Number.isFinite(Number(fixture?.imageWidth))
                ? Number(fixture.imageWidth)
                : 1000,
              imageHeight: Number.isFinite(Number(fixture?.imageHeight))
                ? Number(fixture.imageHeight)
                : 1000,
              pageIndex: Number.isFinite(Number(fixture?.pageIndex))
                ? Number(fixture.pageIndex)
                : newPageIndex,
            }
          : {
              imageData: newImage,
              imageWidth: Number.isFinite(Number(fixture?.imageWidth))
                ? Number(fixture.imageWidth)
                : 1000,
              imageHeight: Number.isFinite(Number(fixture?.imageHeight))
                ? Number(fixture.imageHeight)
                : 1000,
              pageIndex: Number.isFinite(Number(fixture?.pageIndex))
                ? Number(fixture.pageIndex)
                : newPageIndex,
            };

      try {
        localResult = await analyzeMenuImageWithLocalEngine({
          body,
          env: process.env,
        });
      } catch (error) {
        findings.push({
          type: "engine-error",
          caseId,
          detail: asText(error?.message) || "Local engine call failed.",
        });
      }
    }

    if (localResult) {
      const expectedUpdated = Array.isArray(fixture?.expected?.updatedOverlays)
        ? fixture.expected.updatedOverlays
        : [];
      const expectedNew = Array.isArray(fixture?.expected?.newOverlays)
        ? fixture.expected.newOverlays
        : [];
      const actualUpdated = Array.isArray(localResult?.updatedOverlays)
        ? localResult.updatedOverlays
        : [];
      const actualNew = Array.isArray(localResult?.newOverlays) ? localResult.newOverlays : [];

      findings.push(
        ...compareOverlaySets({
          expected: expectedUpdated,
          actual: actualUpdated,
          bucket: "updatedOverlays",
          caseId,
        }),
      );

      findings.push(
        ...compareOverlaySets({
          expected: expectedNew,
          actual: actualNew,
          bucket: "newOverlays",
          caseId,
        }),
      );
    }

    const failed = findings.length > 0;
    report.cases.push({
      id: caseId,
      mode,
      status: failed ? "failed" : "passed",
      message: failed
        ? `${findings.length} finding${findings.length === 1 ? "" : "s"}`
        : "Parity checks passed",
      findings,
    });

    if (failed) {
      report.summary.failedCount += 1;
    } else {
      report.summary.passedCount += 1;
    }
  }

  report.finishedAt = new Date().toISOString();

  await fsp.mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, `${args.runId}.json`);
  const mdPath = path.join(REPORT_DIR, `${args.runId}.md`);
  await fsp.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fsp.writeFile(mdPath, toReportMarkdown(report), "utf8");

  const summary = {
    success: report.summary.failedCount === 0,
    runId: args.runId,
    fixturePath,
    reportJson: jsonPath,
    reportMd: mdPath,
    fixtureCount: report.summary.fixtureCount,
    passedCount: report.summary.passedCount,
    failedCount: report.summary.failedCount,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
