export const myDishesMarkup = String.raw`

  <header class="simple-topbar">
    <div class="simple-topbar-inner">
      <a class="simple-brand" href="/home">
        <img src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
          alt="Clarivore logo">
        <span>Clarivore</span>
      </a>
      <div class="simple-nav">
        <!-- Navigation populated by shared-nav.js -->
      </div>
      <div class="mode-toggle-container" id="modeToggleContainer">
        <!-- Mode toggle populated by JS for managers/owner -->
      </div>
    </div>
  </header>

  <main class="page-main">
    <div class="page-content">
      <h1 style="text-align:center;margin-bottom:8px;">My Dishes</h1>
      <p style="text-align:center;color:var(--muted);margin-bottom:32px;">Your favorite and previously ordered dishes</p>

      <p id="status-message" class="status-text" style="display:none;"></p>

      <div class="two-column-container">
        <!-- Left Column: Loved Dishes -->
        <div class="column">
          <div class="column-header">
            <h2>Loved Dishes</h2>
          </div>
          <p class="column-description">Dishes you've saved to your favorites</p>
          <div id="loved-dishes-container">
            <div class="loading">Loading your favorite dishes...</div>
          </div>
        </div>

        <!-- Right Column: Previously Ordered -->
        <div class="column">
          <div class="column-header">
            <h2>Previously Ordered</h2>
          </div>
          <p class="column-description">Dishes from your approved orders</p>
          <div id="ordered-dishes-container">
            <div class="loading">Loading your order history...</div>
          </div>
        </div>
      </div>
    </div>
  </main>

`;
