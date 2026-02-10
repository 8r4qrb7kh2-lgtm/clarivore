"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient as supabase } from "../lib/supabase";
import { OWNER_EMAIL } from "../lib/managerRestaurants";
import { loadAllergenDietConfig } from "../lib/allergenConfig";

function getDefaultConfig() {
  const normalizeAllergen = (value) => String(value ?? "").trim();
  const normalizeDietLabel = (value) => String(value ?? "").trim();
  return {
    normalizeAllergen,
    normalizeDietLabel,
    getDietAllergenConflicts: () => [],
  };
}

export default function OrderFeedbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || "";

  const [bootError, setBootError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isInvalidToken, setIsInvalidToken] = useState(false);
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [config, setConfig] = useState(() => getDefaultConfig());
  const [topbarUser, setTopbarUser] = useState(null);
  const isManagerOrOwner =
    topbarUser?.email === OWNER_EMAIL ||
    topbarUser?.user_metadata?.role === "manager";

  const menuImages = useMemo(
    () => (Array.isArray(restaurantData?.menu_images) ? restaurantData.menu_images : []),
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

            const blockingIngredients =
              item?.ingredientsBlockingDiets?.[userDiet] || [];
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
    if (!supabase || !feedbackData) return;

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

    setIsSubmitting(true);
    try {
      const { data: feedbackRecord, error: feedbackError } = await supabase
        .from("order_feedback")
        .insert({
          order_id: feedbackData.order_id,
          restaurant_id: feedbackData.restaurant_id,
          user_id: feedbackData.user_id || null,
          restaurant_feedback: trimmedRestaurantFeedback || null,
          website_feedback: trimmedWebsiteFeedback || null,
          restaurant_feedback_include_email: restaurantIncludeEmail,
          website_feedback_include_email: websiteIncludeEmail,
          user_email:
            restaurantIncludeEmail || websiteIncludeEmail
              ? feedbackData.user_email
              : null,
        })
        .select()
        .single();
      if (feedbackError) throw feedbackError;

      if (selectedDishes.length > 0) {
        const accommodationRequests = selectedDishes.map((dishName) => ({
          feedback_id: feedbackRecord.id,
          restaurant_id: feedbackData.restaurant_id,
          user_id: feedbackData.user_id || null,
          dish_name: dishName,
          user_allergens: userAllergens,
          user_diets: userDiets,
        }));
        const { error: requestsError } = await supabase
          .from("accommodation_requests")
          .insert(accommodationRequests);
        if (requestsError) throw requestsError;
      }

      await supabase
        .from("feedback_email_queue")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", feedbackData.id);

      setIsSubmitted(true);
    } catch (error) {
      console.error("[order-feedback] submit failed", error);
      setSubmitError("Failed to submit feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    feedbackData,
    restaurantFeedback,
    websiteFeedback,
    selectedDishes,
    restaurantIncludeEmail,
    websiteIncludeEmail,
    userAllergens,
    userDiets,
  ]);

  useEffect(() => {
    let isMounted = true;
    async function initTopbar() {
      try {
        if (!supabase) return;
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!isMounted) return;
        setTopbarUser(user || null);
      } catch (error) {
        console.error("[order-feedback] topbar init failed", error);
      }
    }
    initTopbar();
    return () => {
      isMounted = false;
    };
  }, []);

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
    let isMounted = true;
    async function init() {
      try {
        if (!supabase) {
          throw new Error("Supabase env vars are missing.");
        }
        if (!token) {
          setIsInvalidToken(true);
          return;
        }

        const loadedConfig = await loadAllergenDietConfig(supabase);
        if (!isMounted) return;
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

        const { data: queueEntry, error: queueError } = await supabase
          .from("feedback_email_queue")
          .select("*")
          .eq("feedback_token", token)
          .maybeSingle();
        if (queueError || !queueEntry) {
          setIsInvalidToken(true);
          return;
        }

        const { data: restaurant, error: restaurantError } = await supabase
          .from("restaurants")
          .select("id, name, slug, overlays, menu_images")
          .eq("id", queueEntry.restaurant_id)
          .maybeSingle();
        if (restaurantError || !restaurant) {
          setIsInvalidToken(true);
          return;
        }

        if (!isMounted) return;
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
      } catch (error) {
        console.error("[order-feedback] init failed", error);
        if (isMounted) {
          setBootError(error?.message || "Failed to load feedback form.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    init();
    return () => {
      isMounted = false;
    };
  }, [token]);

  const currentPageOverlays = useMemo(
    () => overlays.filter((item) => (item.pageIndex || 0) === currentPage),
    [currentPage, overlays],
  );

  return (
    <div className="page-shell">
      <header className="simple-topbar">
        <div className="simple-topbar-inner">
          <Link className="simple-brand" href="/home">
            <img
              src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
              alt="Clarivore logo"
            />
            <span>Clarivore</span>
          </Link>
          <div className="simple-nav">
            <Link href="/home">Home</Link>
            <Link href="/restaurants">Restaurants</Link>
            <Link href="/favorites">My restaurants</Link>
            {isManagerOrOwner ? (
              <Link href="/manager-dashboard">Dashboard</Link>
            ) : null}
            <Link href="/help-contact">Help</Link>
            {topbarUser ? (
              <button type="button" className="btnLink" onClick={onSignOut}>
                Sign out
              </button>
            ) : (
              <Link href="/account?mode=signin">Sign in</Link>
            )}
          </div>
        </div>
      </header>

      <main className="page-main">
        <div className="page-content">
          {isLoading ? (
            <div id="loading-state" className="loading-state">
              <p>Loading your feedback form...</p>
            </div>
          ) : null}

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
              <h1 style={{ textAlign: "center", marginBottom: 8 }}>
                How was your experience?
              </h1>
              <p style={{ textAlign: "center", color: "var(--muted)", marginBottom: 32 }}>
                at <strong id="restaurant-name">{restaurantData?.name || ""}</strong>
              </p>

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
                <textarea
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
                <textarea
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
                <button
                  id="submit-btn"
                  className="submit-btn"
                  disabled={isSubmitting}
                  onClick={submitFeedback}
                >
                  {isSubmitting ? "Submitting..." : "Submit Feedback"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
