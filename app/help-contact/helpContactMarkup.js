export const helpContactMarkup = String.raw`
  <header class="simple-topbar">
    <div class="simple-topbar-inner">
      <a class="simple-brand" href="/home">
        <img src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png" alt="Clarivore logo">
        <span>Clarivore</span>
      </a>
      <div class="simple-nav">
        <!-- Navigation populated by shared-nav.js -->
      </div>
      <div class="mode-toggle-container" id="modeToggleContainer" style="display:none"></div>
    </div>
  </header>

  <main class="help-main">
    <div class="help-container">
      <div class="help-header">
        <h1>Help</h1>
        <p>Ask how to use Clarivore, or send feedback and issues to the team.</p>
      </div>

      <section class="help-panel" id="helpSearchPanel">
        <div class="help-search-row">
          <textarea id="helpQuery" rows="1" placeholder="Ask a question about Clarivore..."></textarea>
          <button class="btn btnPrimary" id="helpAskBtn">Ask</button>
          <button class="btn btnGhost" id="helpNewConversationBtn">New conversation</button>
        </div>
        <div class="help-status" id="helpSearchStatus"></div>
        <div class="help-conversation" id="helpConversation"></div>
      </section>

      <section class="help-grid" id="helpGrid"></section>
    </div>
  </main>


`;
