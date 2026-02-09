export default function HelpContactDom() {
  return (
    <div className="page-shell">
      <header className="simple-topbar">
        <div className="simple-topbar-inner">
          <a className="simple-brand" href="/home">
            <img
              src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
              alt="Clarivore logo"
            />
            <span>Clarivore</span>
          </a>
          <div className="simple-nav" />
          <div
            className="mode-toggle-container"
            id="modeToggleContainer"
            style={{ display: "none" }}
          />
        </div>
      </header>

      <main className="help-main">
        <div className="help-container">
          <div className="help-header">
            <h1>Help</h1>
            <p>Ask how to use Clarivore, or send feedback and issues to the team.</p>
          </div>

          <section className="help-panel" id="helpSearchPanel">
            <div className="help-search-row">
              <textarea
                id="helpQuery"
                rows={1}
                placeholder="Ask a question about Clarivore..."
              />
              <button className="btn btnPrimary" id="helpAskBtn">
                Ask
              </button>
              <button className="btn btnGhost" id="helpNewConversationBtn">
                New conversation
              </button>
            </div>
            <div className="help-status" id="helpSearchStatus" />
            <div className="help-conversation" id="helpConversation" />
          </section>

          <section className="help-grid" id="helpGrid" />
        </div>
      </main>
    </div>
  );
}
