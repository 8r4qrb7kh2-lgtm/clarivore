import assert from "node:assert/strict";
import test from "node:test";

import { formatIngredientBrandAppealSnapshot } from "../ingredientBrandAppeal.js";
import { listIngredientAppealsForAdmin } from "./ingredientAppeals.js";

test("listIngredientAppealsForAdmin merges current row state with newer changelog history", async () => {
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
              photoAttached: true,
              submittedAt: "2026-03-19T10:00:00.000Z",
            },
          },
        },
      ];
    },
    change_logs: {
      async findMany() {
        return [
          {
            id: "log-1",
            restaurant_id: "rest-1",
            timestamp: new Date("2026-03-20T08:00:00.000Z"),
            changes: {
              items: {
                Pizza: [
                  {
                    appealId: "appeal-1",
                    summary: "Pizza: Approved brand assignment appeal for Mozzarella",
                    before: formatIngredientBrandAppealSnapshot({
                      id: "appeal-1",
                      status: "pending",
                      managerMessage: "House-made cheese.",
                      photoAttached: true,
                      submittedAt: "2026-03-19T10:00:00.000Z",
                    }),
                    after: formatIngredientBrandAppealSnapshot({
                      id: "appeal-1",
                      status: "approved",
                      managerMessage: "House-made cheese.",
                      photoAttached: true,
                      submittedAt: "2026-03-19T10:00:00.000Z",
                      reviewedAt: "2026-03-20T08:00:00.000Z",
                      reviewedBy: "Admin Reviewer",
                      reviewNotes: "Looks good.",
                    }),
                  },
                ],
              },
            },
          },
          {
            id: "log-2",
            restaurant_id: "rest-2",
            timestamp: new Date("2026-03-18T09:30:00.000Z"),
            changes: {
              items: {
                Soup: [
                  {
                    appealId: "appeal-2",
                    summary: "Soup: Submitted brand assignment appeal for Broth",
                    before: "Brand assignment appeal: none",
                    after: formatIngredientBrandAppealSnapshot({
                      id: "appeal-2",
                      status: "pending",
                      managerMessage: "Prepared from scratch daily.",
                      photoAttached: true,
                      submittedAt: "2026-03-18T09:30:00.000Z",
                    }),
                  },
                ],
              },
            },
          },
        ];
      },
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
    logLimit: 10,
  });

  assert.equal(appeals.length, 2);

  const activeAppeal = appeals.find((appeal) => appeal.appeal_id === "appeal-1");
  assert.ok(activeAppeal);
  assert.equal(activeAppeal.review_status, "approved");
  assert.equal(activeAppeal.review_notes, "Looks good.");
  assert.equal(activeAppeal.reviewable, true);
  assert.equal(activeAppeal.history_only, false);
  assert.equal(activeAppeal.restaurants?.slug, "pizzeria");

  const historyOnlyAppeal = appeals.find((appeal) => appeal.appeal_id === "appeal-2");
  assert.ok(historyOnlyAppeal);
  assert.equal(historyOnlyAppeal.review_status, "pending");
  assert.equal(historyOnlyAppeal.reviewable, false);
  assert.equal(historyOnlyAppeal.history_only, true);
  assert.equal(historyOnlyAppeal.restaurants?.slug, "soup-shop");
});
