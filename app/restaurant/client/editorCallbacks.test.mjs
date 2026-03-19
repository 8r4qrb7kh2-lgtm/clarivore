import assert from "node:assert/strict";
import test from "node:test";

import { syncIngredientAppealWriteVersion } from "./appealWriteSync.js";

test("syncIngredientAppealWriteVersion forwards the latest restaurant write version", () => {
  const versionSyncCalls = [];
  const synced = syncIngredientAppealWriteVersion({
    persistence: {
      registerExternalRestaurantWrite: (payload) => {
        versionSyncCalls.push(payload);
      },
    },
    restaurantId: "restaurant-1",
    fallbackRestaurantId: "restaurant-fallback",
    payload: {
      success: true,
      restaurantWriteVersion: 12,
    },
  });

  assert.equal(synced, true);
  assert.deepEqual(versionSyncCalls, [
    {
      restaurantId: "restaurant-1",
      writeVersion: 12,
    },
  ]);
});

test("syncIngredientAppealWriteVersion skips invalid payloads", () => {
  let callCount = 0;
  const synced = syncIngredientAppealWriteVersion({
    persistence: {
      registerExternalRestaurantWrite: () => {
        callCount += 1;
      },
    },
    restaurantId: "restaurant-1",
    payload: {},
  });

  assert.equal(synced, false);
  assert.equal(callCount, 0);
});
