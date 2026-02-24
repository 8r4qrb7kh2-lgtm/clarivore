"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppTopbar from "../components/AppTopbar";
import AppLoadingScreen from "../components/AppLoadingScreen";
import PageShell from "../components/PageShell";
import PageHeading from "../components/surfaces/PageHeading";
import { Button, Textarea } from "../components/ui";
import { supabaseClient as supabase } from "../lib/supabase";
import { loadAllergenDietConfig } from "../lib/allergenConfig";
import { queryKeys } from "../lib/queryKeys";
import { hydrateRestaurantWithTableMenuState } from "../lib/restaurantMenuStateClient";

function getDefaultConfig() {
  const normalizeAllergen = (value) => String(value ?? "").trim();
  const normalizeDietLabel = (value) => String(value ?? "").trim();
  return {
    normalizeAllergen,
    normalizeDietLabel,
    getDietAllergenConflicts: () => [],
  };
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveDietLookupToken(value, normalizeDietLabel) {
  const strict = String(
    typeof normalizeDietLabel === "function" ? normalizeDietLabel(value) : "",
  ).trim();
  return normalizeToken(strict || value);
}

function readDietBlockers(item, diet, normalizeDietLabel) {
  const map =
    item?.ingredientsBlockingDiets && typeof item.ingredientsBlockingDiets === "object"
      ? item.ingredientsBlockingDiets
      : null;
  if (!map) return [];

  const target = resolveDietLookupToken(diet, normalizeDietLabel);
  if (!target) return [];

  for (const [key, value] of Object.entries(map)) {
    if (resolveDietLookupToken(key, normalizeDietLabel) !== target) continue;
    if (Array.isArray(value)) return value;
    return [];
  }

  return [];
}

export default function OrderFeedbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || "";

  const [bootError, setBootError] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [restaurantData, setRestaurantData] = useState(null);
  const [feedbackData, setFeedbackData] = useState(null);
  const [userAllergens, setUserAllergens] = useState([]);
  const [userDiets, setUserDiets] = useState([]);
  const [selectedDishes, setSelectedDishes] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [restaurantFeedback, setRestaurantFeedback] = useState("");
  const [websiteFeedback, setWebsiteFeedback] = useState("");
  const [restaurantIncludeEmail, setRestaurantIncludeEmail] = useState(false);
  const [websiteIncludeEmail, setWebsiteIncludeEmail] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [config, setConfig] = useState(() => getDefaultConfig());
  const [topbarUser, setTopbarUser] = useState(null);
  const topbarUserQuery = useQuery({
    queryKey: queryKeys.auth.user("order-feedback"),
    enabled: Boolean(supabase),
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user || null;
    },
    staleTime: 30 * 1000,
  });

  const bootQuery = useQuery({
    queryKey: ["order-feedback", "boot", { token }],
    enabled: Boolean(supabase),
    queryFn: async () => {
      if (!token) {
        return { invalid: true };
      }

      const loadedConfig = await loadAllergenDietConfig(supabase);

      const bootstrapResponse = await fetch(
        `/api/order-feedback/bootstrap?token=${encodeURIComponent(token)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      );
      const bootstrap = await bootstrapResponse.json().catch(() => ({}));
      if (!bootstrapResponse.ok || !bootstrap?.success || bootstrap?.invalid) {
        return { invalid: true };
      }

      const queueEntry =
        bootstrap?.queueEntry && typeof bootstrap.queueEntry === "object"
          ? bootstrap.queueEntry
          : null;
      const restaurantBase =
        bootstrap?.restaurant && typeof bootstrap.restaurant === "object"
          ? bootstrap.restaurant
          : null;
      if (!queueEntry || !restaurantBase) return { invalid: true };

      const restaurant = await hydrateRestaurantWithTableMenuState(
        supabase,
        restaurantBase,
      );

      return {
        invalid: false,
        loadedConfig,
        queueEntry,
        restaurant,
      };
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await fetch("/api/order-feedback/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success || result?.invalid) {
        throw new Error(
          result?.error ||
            "This feedback link is no longer valid. Please request a new one.",
        );
      }
      return true;
    },
  });

  const menuImages = useMemo(
    () => (Array.isArray(restaurantData?.menuImages) ? restaurantData.menuImages : []),
    [restaurantData],
  );

  const overlays = useMemo(
    () => (Array.isArray(restaurantData?.overlays) ? restaurantData.overlays : []),
    [restaurantData],
  );

  const escapeText = useCallback((value) => String(value ?? "").trim(), []);

  const selectedDishSet = useMemo(
    () => new Set(selectedDishes.map((dish) => escapeText(dish)).filter(Boolean)),
    [escapeText, selectedDishes],
  );

  const computeStatus = useCallback(
    (item) => {
      const hasAllergenReqs = userAllergens.length > 0;
      const hasDietReqs = userDiets.length > 0;
      if (!hasAllergenReqs && !hasDietReqs) return "neutral";

      const itemAllergens = (item?.allergens || [])
        .map(config.normalizeAllergen)
        .filter(Boolean);
      const allergenHits = itemAllergens.filter((allergen) =>
        userAllergens.includes(allergen),
      );
      const hasAllergenIssues = allergenHits.length > 0;

      const removableAllergenSet = new Set(
        (item?.removable || [])
          .map((entry) => config.normalizeAllergen(entry?.allergen || ""))
          .filter(Boolean),
      );
      const allergenRemovableAll = hasAllergenIssues
        ? allergenHits.every((allergen) => removableAllergenSet.has(allergen))
        : true;

      const itemDiets = new Set(
        (item?.diets || []).map(config.normalizeDietLabel).filter(Boolean),
      );
      const meetsDietReqs =
        !hasDietReqs || userDiets.every((diet) => itemDiets.has(diet));

      let canBeMadeForDiets = false;
      if (hasDietReqs && !meetsDietReqs) {
        const unmetDiets = userDiets.filter((diet) => !itemDiets.has(diet));
        if (unmetDiets.length) {
          canBeMadeForDiets = unmetDiets.every((userDiet) => {
            const conflicts = config.getDietAllergenConflicts(userDiet);
            const conflictingAllergens = conflicts.filter((allergen) =>
              itemAllergens.includes(allergen),
            );
            const allConflictingAllergensRemovable =
              conflictingAllergens.length > 0 &&
              conflictingAllergens.every((allergen) =>
                removableAllergenSet.has(allergen),
              );

            const blockingIngredients = readDietBlockers(
              item,
              userDiet,
              config.normalizeDietLabel,
            );
            const allBlockingIngredientsRemovable =
              blockingIngredients.length > 0 &&
              blockingIngredients.every((ingredient) => ingredient?.removable);

            const hasBlocks =
              conflictingAllergens.length > 0 || blockingIngredients.length > 0;
            if (!hasBlocks) return false;
            if (
              conflictingAllergens.length > 0 &&
              !allConflictingAllergensRemovable
            ) {
              return false;
            }
            if (
              blockingIngredients.length > 0 &&
              !allBlockingIngredientsRemovable
            ) {
              return false;
            }
            return true;
          });
        }
      }

      if (!meetsDietReqs && !canBeMadeForDiets) return "unsafe";
      if (hasAllergenIssues && !allergenRemovableAll) return "unsafe";
      if (hasAllergenIssues || canBeMadeForDiets) return "removable";
      return "safe";
    },
    [config, userAllergens, userDiets],
  );

  const toggleDishSelection = useCallback((dishName) => {
    const normalized = escapeText(dishName);
    if (!normalized) return;
    setSelectedDishes((current) =>
      current.includes(normalized)
        ? current.filter((dish) => dish !== normalized)
        : [...current, normalized],
    );
  }, [escapeText]);

  const submitFeedback = useCallback(async () => {
    if (!feedbackData) return;

    const trimmedRestaurantFeedback = restaurantFeedback.trim();
    const trimmedWebsiteFeedback = websiteFeedback.trim();
    setSubmitError("");

    if (
      !trimmedRestaurantFeedback &&
      !trimmedWebsiteFeedback &&
      selectedDishes.length === 0
    ) {
      setSubmitError(
        "Please provide some feedback or select dishes for accommodation requests.",
      );
      return;
    }

    try {
      await submitMutation.mutateAsync({
        token,
        restaurantFeedback: trimmedRestaurantFeedback,
        websiteFeedback: trimmedWebsiteFeedback,
        restaurantFeedbackIncludeEmail: restaurantIncludeEmail,
        websiteFeedbackIncludeEmail: websiteIncludeEmail,
        selectedDishes,
        userAllergens,
        userDiets,
      });

      setIsSubmitted(true);
    } catch (error) {
      console.error("[order-feedback] submit failed", error);
      setSubmitError("Failed to submit feedback. Please try again.");
    }
  }, [
    feedbackData,
    token,
    restaurantFeedback,
    websiteFeedback,
    selectedDishes,
    restaurantIncludeEmail,
    websiteIncludeEmail,
    submitMutation,
    userAllergens,
    userDiets,
  ]);

  useEffect(() => {
    setTopbarUser(topbarUserQuery.data || null);
  }, [topbarUserQuery.data]);

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      router.replace("/account?mode=signin");
    } catch (error) {
      console.error("[order-feedback] sign-out failed", error);
      setBootError("Unable to sign out right now.");
    }
  }, [router]);

  useEffect(() => {
    if (!supabase) {
      setBootError("Supabase env vars are missing.");
      return;
    }
    if (bootQuery.isError) {
      setBootError(bootQuery.error?.message || "Failed to load feedback form.");
      return;
    }
    if (!bootQuery.data || bootQuery.data.invalid) return;

    const loadedConfig = bootQuery.data.loadedConfig || getDefaultConfig();
    const queueEntry = bootQuery.data.queueEntry;
    const restaurant = bootQuery.data.restaurant;

    setConfig({
      normalizeAllergen:
        typeof loadedConfig.normalizeAllergen === "function"
          ? loadedConfig.normalizeAllergen
          : getDefaultConfig().normalizeAllergen,
      normalizeDietLabel:
        typeof loadedConfig.normalizeDietLabel === "function"
          ? loadedConfig.normalizeDietLabel
          : getDefaultConfig().normalizeDietLabel,
      getDietAllergenConflicts:
        typeof loadedConfig.getDietAllergenConflicts === "function"
          ? loadedConfig.getDietAllergenConflicts
          : () => [],
    });
    setFeedbackData(queueEntry);
    setRestaurantData(restaurant);
    setUserAllergens(
      (queueEntry.user_allergens || [])
        .map((value) => loadedConfig.normalizeAllergen?.(value))
        .filter(Boolean),
    );
    setUserDiets(
      (queueEntry.user_diets || [])
        .map((value) => loadedConfig.normalizeDietLabel?.(value))
        .filter(Boolean),
    );
  }, [bootQuery.data, bootQuery.error, bootQuery.isError]);

  const isLoading = bootQuery.isPending;
  const isInvalidToken = !isLoading && Boolean(bootQuery.data?.invalid);

  const currentPageOverlays = useMemo(
    () => overlays.filter((item) => (item.pageIndex || 0) === currentPage),
    [currentPage, overlays],
  );

  if (isLoading) {
    return <AppLoadingScreen label="feedback form" />;
  }

  return (
    <PageShell
      shellClassName="page-shell route-order-feedback"
      topbar={
        <AppTopbar mode="customer" user={topbarUser || null} onSignOut={onSignOut} />
      }
    >
          {!isLoading && isInvalidToken ? (
            <div id="invalid-token" className="invalid-token">
              <h1>Invalid or Expired Link</h1>
              <p>
                This feedback link is no longer valid. It may have expired or
                already been used.
              </p>
              <p style={{ marginTop: 20 }}>
                <Link href="/restaurants" style={{ color: "var(--accent)" }}>
                  Return to Restaurants
                </Link>
              </p>
            </div>
          ) : null}

          {!isLoading && isSubmitted ? (
            <div id="success-message" className="success-message">
              <h1>Thank You!</h1>
              <p>Your feedback has been submitted successfully.</p>
              <p style={{ marginTop: 20 }}>
                We appreciate you helping us and the restaurant improve.
              </p>
              <p style={{ marginTop: 30 }}>
                <Link href="/restaurants" style={{ color: "var(--accent)" }}>
                  Browse More Restaurants
                </Link>
              </p>
            </div>
          ) : null}

          {!isLoading && !isInvalidToken && !isSubmitted ? (
            <div id="feedback-form" className="feedback-container">
              <PageHeading
                centered
                title="How was your experience?"
                subtitle={(
                  <>
                    at <strong id="restaurant-name">{restaurantData?.name || ""}</strong>
                  </>
                )}
              />

              {submitError ? (
                <div id="error-container">
                  <div className="error-message">{submitError}</div>
                </div>
              ) : null}
              {bootError ? <div className="error-message">{bootError}</div> : null}

              <div className="feedback-section">
                <h2>Feedback for the Restaurant</h2>
                <p>
                  Share your experience with the restaurant. What did they do
                  well? What could be improved?
                </p>
                <Textarea
                  id="restaurant-feedback"
                  className="feedback-textarea"
                  placeholder="Optional: Share your thoughts about the food, service, or how they handled your dietary needs..."
                  value={restaurantFeedback}
                  onChange={(event) => setRestaurantFeedback(event.target.value)}
                />
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    id="restaurant-include-email"
                    checked={restaurantIncludeEmail}
                    onChange={(event) => setRestaurantIncludeEmail(event.target.checked)}
                  />
                  <span>
                    Include my email so that restaurant management can follow
                    up with me. Otherwise, comments will be shared anonymously.
                  </span>
                </label>
              </div>

              <div className="feedback-section">
                <h2>Feedback for Clarivore</h2>
                <p>Help us improve! Let us know about your experience using our service.</p>
                <Textarea
                  id="website-feedback"
                  className="feedback-textarea"
                  placeholder="Optional: How can we make Clarivore better for you?"
                  value={websiteFeedback}
                  onChange={(event) => setWebsiteFeedback(event.target.value)}
                />
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    id="website-include-email"
                    checked={websiteIncludeEmail}
                    onChange={(event) => setWebsiteIncludeEmail(event.target.checked)}
                  />
                  <span>
                    Include my email so that website development can follow up
                    with me. Otherwise, comments will be shared anonymously.
                  </span>
                </label>
              </div>

              <div className="menu-section">
                <h2>Request Dish Accommodations</h2>
                <p>
                  Click the checkbox on any dish that does not work for you to
                  request the restaurant consider making it available for your
                  dietary needs in the future.
                </p>

                <div id="menu-pages-container">
                  {menuImages.length ? (
                    <>
                      <div className="menu-page-container" data-page={currentPage}>
                        <img
                          src={menuImages[currentPage]}
                          className="menu-image"
                          data-page={currentPage}
                          alt={`Menu page ${currentPage + 1}`}
                        />
                        <div className="overlay-layer">
                          {currentPageOverlays.map((item, index) => {
                            const status = computeStatus(item);
                            const dishName = item?.name || item?.id || `Dish ${index + 1}`;
                            const isChecked = selectedDishSet.has(dishName);
                            return (
                              <div
                                key={`${currentPage}-${dishName}-${index}`}
                                className={`overlay ${status}`}
                                style={{
                                  left: `${+item.x || 0}%`,
                                  top: `${+item.y || 0}%`,
                                  width: `${+item.w || 0}%`,
                                  height: `${+item.h || 0}%`,
                                }}
                              >
                                <div className="overlay-name">{dishName}</div>
                                {status === "unsafe" ? (
                                  <div
                                    className={`overlay-checkbox ${
                                      isChecked ? "checked" : ""
                                    }`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      toggleDishSelection(dishName);
                                    }}
                                  >
                                    <svg viewBox="0 0 24 24">
                                      <path d="M20 6L9 17l-5-5" />
                                    </svg>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {menuImages.length > 1 ? (
                        <div className="page-nav">
                          {menuImages.map((_, index) => (
                            <button
                              key={`page-${index + 1}`}
                              className={index === currentPage ? "active" : ""}
                              onClick={() => setCurrentPage(index)}
                            >
                              Page {index + 1}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p style={{ color: "var(--muted)", textAlign: "center" }}>
                      No menu images available.
                    </p>
                  )}
                </div>

                <div
                  id="selected-dishes"
                  className="selected-dishes"
                  style={{ display: selectedDishes.length ? "block" : "none" }}
                >
                  <h3>Dishes you would like accommodated:</h3>
                  <div id="selected-dishes-list">
                    {selectedDishes.map((dish) => (
                      <div className="selected-dish-item" key={`selected-${dish}`}>
                        <span className="selected-dish-name">{dish}</span>
                        <button
                          className="remove-dish-btn"
                          onClick={() => toggleDishSelection(dish)}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="submit-section">
                <Button
                  id="submit-btn"
                  className="submit-btn"
                  loading={submitMutation.isPending}
                  disabled={submitMutation.isPending}
                  onClick={submitFeedback}
                >
                  {submitMutation.isPending ? "Submitting..." : "Submit Feedback"}
                </Button>
              </div>
            </div>
          ) : null}
    </PageShell>
  );
}
