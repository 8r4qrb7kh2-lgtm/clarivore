import { BRAND_IMAGE_FALLBACK } from "../constants/dashboardConstants";

// Two-column area with recent change logs and brand item management list.
export function ChangesAndBrandsSection({
  recentChangesLoading,
  parsedChangeLogs,
  onViewFullLog,
  currentRestaurantData,
  brandSearchQuery,
  setBrandSearchQuery,
  brandItems,
  filteredBrandItems,
  expandedBrandKeys,
  onToggleBrandItem,
  onOpenDishEditor,
  isReplacingBrand,
  onReplaceBrand,
}) {
  return (
    <div className="section">
      <div className="dashboard-split">
        <div className="dashboard-panel">
          <div className="section-header">
            <h2 className="section-title">Recent changes</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
              Review the latest edits to your menu.
            </p>
          </div>

          <div id="recent-changes-list" className="recent-changes-list">
            {recentChangesLoading ? (
              <div className="loading-state" style={{ padding: 20, textAlign: "center" }}>
                <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 8px" }} />
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>Loading...</p>
              </div>
            ) : parsedChangeLogs.length === 0 ? (
              <div className="no-changes-message">No changes recorded yet</div>
            ) : (
              parsedChangeLogs.map((entry) => (
                <div className="recent-change-item" key={entry.id}>
                  <div className="recent-change-header">
                    <span className="recent-change-author">{entry.author}</span>
                    <span className="recent-change-time">{entry.timestamp}</span>
                  </div>

                  <div className="recent-change-details">
                    {entry.hasDetails ? (
                      <>
                        {entry.dishChanges.map((dish) => (
                          <div key={`${entry.id}-${dish.dishName}`}>
                            <div className="recent-change-dish">{dish.dishName}</div>
                            {dish.lines.length ? (
                              <ul className="recent-change-list">
                                {dish.lines.map((line, index) => (
                                  <li key={`${entry.id}-${dish.dishName}-${index}`}>{line}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ))}

                        {entry.generalChanges.length ? (
                          <div className="recent-change-general">
                            <ul className="recent-change-list">
                              {entry.generalChanges.map((line, index) => (
                                <li key={`${entry.id}-general-${index}`}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>Menu updated</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            className="btn"
            id="viewFullLogBtn"
            style={{ width: "100%", marginTop: 16 }}
            onClick={onViewFullLog}
          >
            View full change log
          </button>
        </div>

        <div className="dashboard-panel">
          <div className="section-header">
            <h2 className="section-title brand-items-title">Brand items in use</h2>
          </div>

          <div className="brand-items-search">
            <input
              id="brand-items-search"
              className="brand-search-input"
              type="search"
              placeholder="Search brand items..."
              value={brandSearchQuery}
              onChange={(event) => setBrandSearchQuery(event.target.value)}
            />
          </div>

          <div id="brand-items-list" className="brand-items-list">
            {!currentRestaurantData ? (
              <div className="chat-preview-empty">Select a restaurant to view brand items.</div>
            ) : !brandItems.length ? (
              <div className="chat-preview-empty">No brand items found yet.</div>
            ) : !filteredBrandItems.length ? (
              <div className="chat-preview-empty">No brand items match your search.</div>
            ) : (
              filteredBrandItems.map((item) => {
                const isExpanded = Boolean(expandedBrandKeys[item.key]);

                return (
                  <div key={item.key} className="brand-item-card" data-expanded={isExpanded ? "true" : "false"}>
                    <div className="brand-item-summary">
                      <img
                        className="brand-item-thumb"
                        src={item.brandImage || BRAND_IMAGE_FALLBACK}
                        alt={item.brandName}
                      />
                      <div className="brand-item-meta">
                        <p className="brand-item-name">{item.brandName}</p>
                        <div className="brand-item-subtitle">
                          {item.ingredientNames.length
                            ? `Ingredients: ${item.ingredientNames.join(", ")}`
                            : "Ingredient details unavailable"}
                        </div>
                        <div className="brand-item-subtitle">
                          {item.dishes.length} dish{item.dishes.length === 1 ? "" : "es"}
                        </div>
                      </div>
                    </div>

                    <div className="brand-item-details">
                      <div className="brand-item-details-row">
                        <div>
                          <div className="brand-item-subtitle" style={{ marginBottom: 6 }}>Allergens</div>
                          <div className="brand-item-tags">
                            {item.allergens.length ? (
                              item.allergens.map((allergen) => (
                                <span className="brand-tag" key={`${item.key}-allergen-${allergen}`}>
                                  {allergen}
                                </span>
                              ))
                            ) : (
                              <span className="brand-tag" style={{ opacity: 0.7 }}>
                                No allergens listed
                              </span>
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="brand-item-subtitle" style={{ marginBottom: 6 }}>Diets</div>
                          <div className="brand-item-tags">
                            {item.diets.length ? (
                              item.diets.map((diet) => (
                                <span className="brand-tag" key={`${item.key}-diet-${diet}`}>
                                  {diet}
                                </span>
                              ))
                            ) : (
                              <span className="brand-tag" style={{ opacity: 0.7 }}>
                                No diets listed
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="brand-item-subtitle" style={{ marginBottom: 6 }}>
                          Dishes using this item
                        </div>
                        <div className="brand-item-dish-list">
                          {item.dishes.length ? (
                            item.dishes.map((dishName) => {
                              const ingredientForDish = item.dishIngredients?.[dishName]?.[0] || "";
                              return (
                                <div className="brand-item-dish-entry" key={`${item.key}-${dishName}`}>
                                  <span className="brand-tag brand-item-dish-name">{dishName}</span>
                                  <button
                                    className="btn brand-item-dish-link"
                                    type="button"
                                    onClick={() => onOpenDishEditor(dishName, ingredientForDish)}
                                  >
                                    Open ↗
                                  </button>
                                </div>
                              );
                            })
                          ) : (
                            <div className="brand-item-empty">No dishes listed</div>
                          )}
                        </div>
                      </div>

                      <div className="brand-item-actions">
                        <button
                          className="btn btnPrimary"
                          type="button"
                          disabled={isReplacingBrand}
                          onClick={() => onReplaceBrand(item)}
                        >
                          {isReplacingBrand ? "Working..." : "Replace item"}
                        </button>
                      </div>
                    </div>

                    <button
                      className="btn brand-item-more"
                      type="button"
                      onClick={() => onToggleBrandItem(item.key)}
                    >
                      {isExpanded ? "Minimize" : "More options"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
