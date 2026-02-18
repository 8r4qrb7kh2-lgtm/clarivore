// Modal used to complete accommodation-request actions with optional manager note.
export function RequestActionModal({
  activeRequestAction,
  activeRequestActionConfig,
  requestResponseText,
  setRequestResponseText,
  isUpdatingRequest,
  closeRequestActionModal,
  submitRequestAction,
}) {
  return (
    <div
      className={`response-modal${activeRequestAction ? " show" : ""}`}
      id="response-modal"
      onClick={(event) => {
        // Backdrop click closes modal; inner clicks are handled by child controls.
        if (event.target === event.currentTarget) {
          closeRequestActionModal();
        }
      }}
    >
      {activeRequestAction ? (
        <div className="response-modal-content">
          <h3 id="modal-title">{activeRequestActionConfig?.title || "Respond to Request"}</h3>
          <p id="modal-dish" style={{ color: "var(--muted)", marginBottom: 16 }}>
            Dish: {activeRequestAction.dishName}
          </p>
          <textarea
            id="response-text"
            placeholder="Add a response message (optional)..."
            value={requestResponseText}
            onChange={(event) => setRequestResponseText(event.target.value)}
            disabled={isUpdatingRequest}
          />
          <div className="modal-actions">
            <button
              className="action-btn"
              id="modal-cancel"
              type="button"
              onClick={closeRequestActionModal}
              disabled={isUpdatingRequest}
            >
              Cancel
            </button>
            <button
              className={`action-btn ${activeRequestActionConfig?.buttonClass || "primary"}`}
              id="modal-implement"
              type="button"
              onClick={submitRequestAction}
              disabled={isUpdatingRequest}
            >
              {isUpdatingRequest
                ? "Updating..."
                : activeRequestActionConfig?.buttonLabel || "Submit"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
