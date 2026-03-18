import assert from "node:assert/strict";
import test from "node:test";

const { buildWordLayout } = await import("./analysisClient.js");

function simplifyLayout(layout) {
  return layout.map((token) => ({
    text: token.text,
    leftPct: Number(token.leftPct.toFixed(2)),
    widthPct: Number(token.widthPct.toFixed(2)),
    centerPct: Number(token.centerPct.toFixed(2)),
    hasMatchedBounds: Boolean(token.hasMatchedBounds),
  }));
}

test("buildWordLayout preserves matched OCR widths inside the crop", () => {
  const layout = buildWordLayout({
    text: "NO GMOs",
    crop_coordinates: {
      x_start: 10,
      x_end: 50,
    },
    words: [
      { text: "NO", x_start: 12, x_end: 16 },
      { text: "GMOs", x_start: 20, x_end: 30 },
    ],
  });

  assert.deepEqual(simplifyLayout(layout), [
    {
      text: "NO",
      leftPct: 5,
      widthPct: 10,
      centerPct: 10,
      hasMatchedBounds: true,
    },
    {
      text: "GMOs",
      leftPct: 25,
      widthPct: 25,
      centerPct: 37.5,
      hasMatchedBounds: true,
    },
  ]);
});

test("buildWordLayout keeps repeated transcript tokens matched in reading order", () => {
  const layout = buildWordLayout({
    text: "milk and milk",
    crop_coordinates: {
      x_start: 0,
      x_end: 100,
    },
    words: [
      { text: "milk", x_start: 5, x_end: 20 },
      { text: "and", x_start: 24, x_end: 31 },
      { text: "milk", x_start: 64, x_end: 92 },
    ],
  });

  assert.deepEqual(
    layout.map((token) => ({
      text: token.text,
      leftPct: Number(token.leftPct.toFixed(2)),
      widthPct: Number(token.widthPct.toFixed(2)),
    })),
    [
      { text: "milk", leftPct: 5, widthPct: 15 },
      { text: "and", leftPct: 24, widthPct: 7 },
      { text: "milk", leftPct: 64, widthPct: 28 },
    ],
  );
});

test("buildWordLayout falls back to evenly sized boxes when OCR bounds are missing", () => {
  const layout = buildWordLayout({
    text: "organic pasta flour",
    crop_coordinates: {
      x_start: 0,
      x_end: 90,
    },
    words: [],
  });

  assert.deepEqual(simplifyLayout(layout), [
    {
      text: "organic",
      leftPct: 0.5,
      widthPct: 32.33,
      centerPct: 16.67,
      hasMatchedBounds: false,
    },
    {
      text: "pasta",
      leftPct: 33.83,
      widthPct: 32.33,
      centerPct: 50,
      hasMatchedBounds: false,
    },
    {
      text: "flour",
      leftPct: 67.17,
      widthPct: 32.33,
      centerPct: 83.33,
      hasMatchedBounds: false,
    },
  ]);
});
