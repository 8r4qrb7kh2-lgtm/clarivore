export default function RestaurantReportShellTemplate() {
  return (
    <template id="reportWorkspaceTemplate">
      <h1>Report an issue</h1>
      <div style={{ maxWidth: 640 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "8px 0" }}>
          <input id="rName" type="text" placeholder="Your name" style={{ flex: 1 }} />
          <input
            id="rEmail"
            type="email"
            placeholder="Email (required)"
            style={{ flex: 1 }}
          />
        </div>
        <textarea
          id="rMsg"
          rows={6}
          style={{ width: "100%", borderRadius: 16 }}
          placeholder="Describe the issue"
        />
        <div className="mgrRow" style={{ justifyContent: "flex-start" }}>
          <button className="btn btnPrimary" id="rSend">
            Send
          </button>
        </div>
        <div className="note">We require an email so we can follow up if needed.</div>
      </div>
    </template>
  );
}
