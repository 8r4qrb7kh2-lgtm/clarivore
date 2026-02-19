// Shared menu-confirmation panel used across dashboard sections.
export function MenuConfirmationPanel({ confirmationInfo, onConfirmNow }) {
  return (
    <div className="dashboard-panel">
      <div className="section-header">
        <h2 className="section-title">Menu Confirmation</h2>
      </div>
      <div id="confirmation-status" className="confirmation-status">
        <div className="confirmation-info">
          <div className="confirmation-due-label">Next confirmation due</div>
          <div className={`confirmation-due-date ${confirmationInfo?.dueDateClass || "overdue"}`}>
            {confirmationInfo?.dueText || "Never confirmed"}
          </div>
          <div className="confirmation-last">
            {confirmationInfo?.lastConfirmedText || "Never confirmed"}
          </div>
          <button className="btn btnPrimary" id="confirmNowBtn" onClick={onConfirmNow}>
            Confirm information is up-to-date
          </button>
        </div>
      </div>
    </div>
  );
}
