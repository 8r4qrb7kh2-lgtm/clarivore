import assert from "node:assert/strict";
import test from "node:test";

import { listIngredientAppealsForAdmin } from "./ingredientAppeals.js";

test("listIngredientAppealsForAdmin returns current ingredient-row appeal payloads", async () => {
  const dbClient = {
    async $queryRawUnsafe() {
      return [
        {
          id: "row-1",
          restaurant_id: "rest-1",
          dish_name: "Pizza",
          row_index: 0,
          row_text: "Mozzarella",
          updated_at: "2026-03-19T10:00:00.000Z",
          ingredient_payload: {
            name: "Mozzarella",
            brandAppeal: {
              id: "appeal-1",
              status: "pending",
              managerMessage: "House-made cheese.",
              photoDataUrl: "data:image/jpeg;base64,abc123",
              photoAttached: true,
              submittedAt: "2026-03-19T10:00:00.000Z",
            },
          },
        },
        {
          id: "row-2",
          restaurant_id: "rest-2",
          dish_name: "Soup",
          row_index: 1,
          row_text: "Broth",
          updated_at: "2026-03-20T08:00:00.000Z",
          ingredient_payload: {
            name: "Broth",
            brandAppeal: {
              id: "appeal-2",
              status: "approved",
              managerMessage: "Prepared from scratch daily.",
              photoDataUrl: "data:image/jpeg;base64,def456",
              photoAttached: true,
              submittedAt: "2026-03-18T09:30:00.000Z",
              reviewedAt: "2026-03-20T08:00:00.000Z",
              reviewedBy: "Admin Reviewer",
              reviewNotes: "Looks good.",
            },
          },
        },
      ];
    },
    restaurants: {
      async findMany() {
        return [
          { id: "rest-1", name: "Pizzeria", slug: "pizzeria" },
          { id: "rest-2", name: "Soup Shop", slug: "soup-shop" },
        ];
      },
    },
  };

  const appeals = await listIngredientAppealsForAdmin(dbClient, {
    limit: 10,
  });

  assert.equal(appeals.length, 2);
  assert.equal(appeals[0]?.appeal_id, "appeal-2");
  assert.equal(appeals[0]?.ingredient_row_id, "row-2");
  assert.equal(appeals[0]?.review_status, "approved");
  assert.equal(appeals[0]?.review_notes, "Looks good.");
  assert.equal(appeals[0]?.photo_data_url, "data:image/jpeg;base64,def456");
  assert.equal(appeals[0]?.restaurants?.slug, "soup-shop");
  assert.equal(appeals[0]?.history_only, false);

  assert.equal(appeals[1]?.appeal_id, "appeal-1");
  assert.equal(appeals[1]?.ingredient_row_id, "row-1");
  assert.equal(appeals[1]?.review_status, "pending");
  assert.equal(appeals[1]?.photo_data_url, "data:image/jpeg;base64,abc123");
  assert.equal(appeals[1]?.restaurants?.slug, "pizzeria");
});
