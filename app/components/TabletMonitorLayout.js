import SimpleTopbar from "./SimpleTopbar";

const HEADER_ROW_STYLE = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 12,
};

export function TabletMonitorPage({
  brandHref = "/restaurants",
  links = [],
  signedIn = false,
  onSignOut,
  children,
}) {
  return (
    <>
      <SimpleTopbar
        brandHref={brandHref}
        links={links}
        showAuthAction
        signedIn={signedIn}
        onSignOut={onSignOut}
      />
      <main className="page-main">
        <div className="page-content tablet-page">{children}</div>
      </main>
    </>
  );
}

export function TabletMonitorHeader({
  title,
  subtitle,
  onRefresh,
  refreshing = false,
  refreshDisabled = false,
  statusContent = null,
  filterId,
  showCompleted = false,
  onShowCompletedChange,
  filterLabel = "Show completed/rescinded",
}) {
  return (
    <header>
      <div style={HEADER_ROW_STYLE}>
        <div>
          <h1>{title}</h1>
          <p className="muted-text">{subtitle}</p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          style={{ whiteSpace: "nowrap" }}
          onClick={onRefresh}
          disabled={refreshDisabled}
        >
          {refreshing ? "Refreshing..." : "Refresh orders"}
        </button>
      </div>

      {statusContent}

      <div className="tablet-filters">
        <label className="tablet-filter" htmlFor={filterId}>
          <input
            type="checkbox"
            id={filterId}
            checked={showCompleted}
            onChange={(event) => onShowCompletedChange?.(event.target.checked)}
          />
          <span>{filterLabel}</span>
        </label>
      </div>
    </header>
  );
}

export function TabletEmptyState({ children }) {
  return <div className="empty-tablet-state">{children}</div>;
}
