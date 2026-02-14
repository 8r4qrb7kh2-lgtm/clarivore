import assert from "node:assert/strict";
import test from "node:test";

import { __test } from "./localRepositionEngine.mjs";

function effectivePads(dish) {
  return {
    left: Math.max(0, Number(dish.contentXMin) - Number(dish.xMin)),
    top: Math.max(0, Number(dish.contentYMin) - Number(dish.yMin)),
    right: Math.max(0, Number(dish.xMax) - Number(dish.contentXMax)),
    bottom: Math.max(0, Number(dish.yMax) - Number(dish.contentYMax)),
  };
}

function assertUniformPads(dish) {
  const pads = effectivePads(dish);
  assert.equal(pads.left, pads.top);
  assert.equal(pads.left, pads.right);
  assert.equal(pads.left, pads.bottom);
}

function boxesOverlap(a, b) {
  return !(
    Number(a.xMax) <= Number(b.xMin) ||
    Number(b.xMax) <= Number(a.xMin) ||
    Number(a.yMax) <= Number(b.yMin) ||
    Number(b.yMax) <= Number(a.yMin)
  );
}

test("resolveOverlaps enforces symmetric padding after vertical overlap restriction", () => {
  const dishes = [
    {
      name: "Dish A",
      contentXMin: 100,
      contentYMin: 100,
      contentXMax: 300,
      contentYMax: 150,
      xMin: 92,
      yMin: 92,
      xMax: 308,
      yMax: 158,
    },
    {
      name: "Dish B",
      contentXMin: 100,
      contentYMin: 150,
      contentXMax: 300,
      contentYMax: 200,
      xMin: 92,
      yMin: 142,
      xMax: 308,
      yMax: 208,
    },
  ];

  const resolved = __test.resolveOverlaps(dishes, { width: 1000, height: 1000 });

  assert.equal(resolved.length, 2);
  assertUniformPads(resolved[0]);
  assertUniformPads(resolved[1]);
  assert.equal(boxesOverlap(resolved[0], resolved[1]), false);
});

test("resolveOverlaps applies edge-limited padding symmetrically for single-dish pages", () => {
  const dishes = [
    {
      name: "Edge Dish",
      contentXMin: 3,
      contentYMin: 100,
      contentXMax: 103,
      contentYMax: 150,
      xMin: 0,
      yMin: 92,
      xMax: 111,
      yMax: 158,
    },
  ];

  const [resolved] = __test.resolveOverlaps(dishes, { width: 1000, height: 1000 });
  const pads = effectivePads(resolved);

  assert.equal(pads.left, 3);
  assertUniformPads(resolved);
  assert.equal(resolved.xMin, 0);
  assert.equal(resolved.yMin, 97);
  assert.equal(resolved.xMax, 106);
  assert.equal(resolved.yMax, 153);
});

test("resolveOverlaps preserves already-symmetric padding when unconstrained", () => {
  const dish = {
    name: "Centered Dish",
    contentXMin: 200,
    contentYMin: 300,
    contentXMax: 400,
    contentYMax: 360,
    xMin: 192,
    yMin: 292,
    xMax: 408,
    yMax: 368,
  };

  const [resolved] = __test.resolveOverlaps([dish], { width: 1000, height: 1000 });

  assert.deepEqual(
    {
      xMin: resolved.xMin,
      yMin: resolved.yMin,
      xMax: resolved.xMax,
      yMax: resolved.yMax,
    },
    {
      xMin: 192,
      yMin: 292,
      xMax: 408,
      yMax: 368,
    },
  );
  assertUniformPads(resolved);
});

test("resolveOverlaps keeps dishes non-overlapping after symmetric normalization", () => {
  const dishes = [
    {
      name: "Left Dish",
      contentXMin: 100,
      contentYMin: 100,
      contentXMax: 220,
      contentYMax: 160,
      xMin: 92,
      yMin: 92,
      xMax: 228,
      yMax: 168,
    },
    {
      name: "Right Dish",
      contentXMin: 210,
      contentYMin: 100,
      contentXMax: 330,
      contentYMax: 160,
      xMin: 202,
      yMin: 92,
      xMax: 338,
      yMax: 168,
    },
  ];

  const resolved = __test.resolveOverlaps(dishes, { width: 1000, height: 1000 });

  assert.equal(boxesOverlap(resolved[0], resolved[1]), false);
  resolved.forEach((dish) => assertUniformPads(dish));
});
