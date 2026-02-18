import { toRequestDateLabel } from "../utils/displayUtils";

// Two-column area with accommodation request workflow and generated improvement suggestions.
export function RequestsAndSuggestionsSection({
  pendingRequestCount,
  requestFilter,
  setRequestFilter,
  filteredRequests,
  openRequestActionModal,
  requestSuggestions,
  normalizeAllergen,
  normalizeDietLabel,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  formatAllergenLabel,
}) {
  return (
    <div className="section">
      <div className="dashboard-split">
        <div className="dashboard-panel">
          <div className="section-header">
            <h2 className="section-title">Accommodation Requests</h2>
            <span className="request-count">{pendingRequestCount} pending</span>
          </div>
          <div className="tabs">
            <button
              type="button"
              className={`tab-btn${requestFilter === "pending" ? " active" : ""}`}
              onClick={() => setRequestFilter("pending")}
            >
              Pending
            </button>
            <button
              type="button"
              className={`tab-btn${requestFilter === "all" ? " active" : ""}`}
              onClick={() => setRequestFilter("all")}
            >
              All
            </button>
          </div>

          <div id="requests-list">
            {filteredRequests.length === 0 ? (
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 12l2 2 4-4" />
                  <circle cx="12" cy="12" r="10" />
                </svg>
                <p>
                  {requestFilter === "pending"
                    ? "No pending accommodation requests"
                    : "No accommodation requests yet"}
                </p>
              </div>
            ) : (
              filteredRequests.map((request) => {
                const requestedAllergens = (request.requested_allergens || [])
                  .map(normalizeAllergen)
                  .filter(Boolean);
                const requestedDiets = (request.requested_diets || [])
                  .map(normalizeDietLabel)
                  .filter(Boolean);
                const status = String(request.status || "pending").toLowerCase();
                const isPending = status === "pending";

                return (
                  <div className="request-card" data-request-id={request.id} key={request.id}>
                    <div className="request-header">
                      <div>
                        <div className="request-dish">{request.dish_name || "Unknown dish"}</div>
                        <div className="request-date">{toRequestDateLabel(request.created_at)}</div>
                      </div>
                      <span className={`status-badge ${status}`}>{status}</span>
                    </div>

                    <div className="request-details">
                      <div className="request-needs">
                        {requestedAllergens.length ? (
                          <div className="request-needs-group">
                            <span className="request-needs-label">Allergen accommodations needed</span>
                            <div>
                              {requestedAllergens.map((allergen) => (
                                <span className="allergen-badge" key={`${request.id}-${allergen}`}>
                                  {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {requestedDiets.length ? (
                          <div className="request-needs-group">
                            <span className="request-needs-label">Dietary accommodations needed</span>
                            <div>
                              {requestedDiets.map((diet) => (
                                <span className={`diet-badge ${diet.toLowerCase()}`} key={`${request.id}-${diet}`}>
                                  {DIET_EMOJI[diet] || "🍽️"} {diet}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {request.manager_response ? (
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 12,
                          borderRadius: 8,
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 4 }}>
                          Manager Response
                        </div>
                        <div>{request.manager_response}</div>
                      </div>
                    ) : null}

                    {isPending ? (
                      <div className="request-actions">
                        <button
                          type="button"
                          className="action-btn success"
                          onClick={() => openRequestActionModal(request, "implemented")}
                        >
                          Mark Implemented
                        </button>
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => openRequestActionModal(request, "reviewed")}
                        >
                          Mark Reviewed
                        </button>
                        <button
                          type="button"
                          className="action-btn decline"
                          onClick={() => openRequestActionModal(request, "declined")}
                        >
                          Decline
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="section-header">
            <h2 className="section-title">Improvement Suggestions</h2>
          </div>

          <div id="suggestions-list">
            {requestSuggestions.length === 0 ? (
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <p>More request and interaction data is needed to generate suggestions.</p>
              </div>
            ) : (
              requestSuggestions.map((suggestion, index) => (
                <div className="suggestion-card" key={`${suggestion.title}-${index}`}>
                  <div className="suggestion-icon">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      width="24"
                      height="24"
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>

                  <div className="suggestion-title">{suggestion.title}</div>
                  <div className="suggestion-description">{suggestion.description}</div>

                  <div className="suggestion-impact">
                    <div className="impact-item">
                      <span className="positive">+{suggestion.potentialUsers}</span>
                      <span style={{ color: "var(--muted)" }}>potential users</span>
                    </div>
                    <div className="impact-item">
                      <span style={{ color: "var(--muted)" }}>Priority:</span>
                      <span
                        style={{
                          color:
                            suggestion.priority === "high"
                              ? "#ef4444"
                              : suggestion.priority === "medium"
                                ? "#facc15"
                                : "var(--muted)",
                        }}
                      >
                        {suggestion.priority}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
