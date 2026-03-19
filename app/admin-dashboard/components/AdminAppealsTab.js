"use client";

function toDateLabel(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

const APPEAL_FILTERS = [
  { id: "all", label: "All Appeals" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

export default function AdminAppealsTab({
  appealsLoading,
  filteredAppeals,
  appealFilter,
  onFilterChange,
  appealNotesById,
  onAppealNoteChange,
  appealBusyId,
  onReviewAppeal,
  onOpenPhoto,
}) {
  return (
    <div className="tab-content active">
      <div className="admin-card admin-card-full">
        <h2>📷 Ingredient Scan Appeals</h2>
        <p style={{ color: "#718096", marginBottom: 24 }}>
          Review and approve or reject manager appeals for ingredient scanning
          requirements.
        </p>

        <div className="appeals-filters">
          {APPEAL_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`filter-btn${appealFilter === filter.id ? " active" : ""}`}
              onClick={() => onFilterChange(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {appealsLoading ? (
          <div id="loading-appeals" className="loading">
            <p>Loading appeals...</p>
          </div>
        ) : filteredAppeals.length === 0 ? (
          <div id="no-appeals" className="no-appeals">
            <h3>No appeals found</h3>
            <p>There are no appeals matching your current filter.</p>
          </div>
        ) : (
          <div id="appeals-list" className="appeals-list">
            {filteredAppeals.map((appeal) => {
              const status = appeal.review_status || "pending";
              const restaurant = appeal.restaurants || {};
              const appealPhotoUrl =
                String(appeal.photo_url || appeal.photo_data_url || "").trim();
              const isBusy = appealBusyId === appeal.id;

              return (
                <div key={appeal.id} className={`appeal-card ${status}`}>
                  <div className="appeal-header">
                    <div className="appeal-info">
                      <h3>{appeal.ingredient_name}</h3>
                      <div className="appeal-meta">
                        <span>
                          <strong>Restaurant:</strong> {restaurant.name || "Unknown"}
                        </span>
                        {appeal.dish_name ? (
                          <span>
                            <strong>Dish:</strong> {appeal.dish_name}
                          </span>
                        ) : null}
                        <span>
                          <strong>Submitted:</strong> {toDateLabel(appeal.submitted_at)}
                        </span>
                        {appeal.reviewed_at ? (
                          <span>
                            <strong>Reviewed:</strong> {toDateLabel(appeal.reviewed_at)}
                          </span>
                        ) : null}
                        {appeal.reviewed_by ? (
                          <span>
                            <strong>Reviewer:</strong> {appeal.reviewed_by}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className={`appeal-status ${status}`}>{status}</span>
                  </div>

                  {appeal.manager_message ? (
                    <div className="appeal-message">
                      <strong>Manager Message:</strong> {appeal.manager_message}
                    </div>
                  ) : null}

                  {appealPhotoUrl ? (
                    <div style={{ margin: "16px 0" }}>
                      <strong
                        style={{
                          color: "#1e3a5f",
                          display: "block",
                          marginBottom: 8,
                        }}
                      >
                        Photo submitted:
                      </strong>
                      <img
                        src={appealPhotoUrl}
                        alt="Appeal"
                        className="appeal-photo"
                        loading="lazy"
                        decoding="async"
                        onClick={() => onOpenPhoto(appealPhotoUrl)}
                      />
                    </div>
                  ) : null}

                  {status === "pending" && appeal.reviewable === true ? (
                    <>
                      <div className="review-notes">
                        <label
                          style={{
                            color: "#1e3a5f",
                            display: "block",
                            marginBottom: 8,
                            fontWeight: 600,
                          }}
                        >
                          <strong>Review Notes (optional):</strong>
                        </label>
                        <textarea
                          value={appealNotesById[appeal.id] || ""}
                          placeholder="Add any notes about your decision..."
                          onChange={(event) =>
                            onAppealNoteChange(appeal.id, event.target.value)
                          }
                          disabled={isBusy}
                        />
                      </div>
                      <div className="appeal-actions">
                        <button
                          type="button"
                          className="btn-approve"
                          onClick={() => onReviewAppeal(appeal, "approved")}
                          disabled={isBusy}
                        >
                          {isBusy ? "Approving..." : "✓ Approve"}
                        </button>
                        <button
                          type="button"
                          className="btn-deny"
                          onClick={() => onReviewAppeal(appeal, "rejected")}
                          disabled={isBusy}
                        >
                          {isBusy ? "Rejecting..." : "✗ Reject"}
                        </button>
                        {restaurant.slug ? (
                          <a
                            href={`/restaurant?slug=${restaurant.slug}`}
                            className="btn-view-restaurant"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View Restaurant
                          </a>
                        ) : null}
                      </div>
                    </>
                  ) : status === "pending" ? (
                    <div className="appeal-actions">
                      <p style={{ color: "#1e3a5f" }}>
                        This appeal only exists in change history and can no longer be reviewed from
                        here.
                      </p>
                      {restaurant.slug ? (
                        <a
                          href={`/restaurant?slug=${restaurant.slug}`}
                          className="btn-view-restaurant"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View Restaurant
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <div className="appeal-actions">
                      {appeal.review_notes ? (
                        <p style={{ color: "#1e3a5f" }}>
                          <strong style={{ color: "#1e3a5f" }}>Review Notes:</strong>{" "}
                          {appeal.review_notes}
                        </p>
                      ) : null}
                      {restaurant.slug ? (
                        <a
                          href={`/restaurant?slug=${restaurant.slug}`}
                          className="btn-view-restaurant"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View Restaurant
                        </a>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
