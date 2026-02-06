export const orderFeedbackMarkup = String.raw`

  <header class="simple-topbar">
    <div class="simple-topbar-inner">
      <a class="simple-brand" href="/home">
        <img src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png" alt="Clarivore logo">
        <span>Clarivore</span>
      </a>
    </div>
  </header>

  <main class="page-main">
    <div class="page-content">
      <div id="loading-state" class="loading-state">
        <p>Loading your feedback form...</p>
      </div>

      <div id="invalid-token" class="invalid-token" style="display:none;">
        <h1>Invalid or Expired Link</h1>
        <p>This feedback link is no longer valid. It may have expired or already been used.</p>
        <p style="margin-top:20px;"><a href="/restaurants" style="color:var(--accent);">Return to Restaurants</a></p>
      </div>

      <div id="success-message" class="success-message" style="display:none;">
        <h1>Thank You!</h1>
        <p>Your feedback has been submitted successfully.</p>
        <p style="margin-top:20px;">We appreciate you helping us and the restaurant improve!</p>
        <p style="margin-top:30px;"><a href="/restaurants" style="color:var(--accent);">Browse More Restaurants</a></p>
      </div>

      <div id="feedback-form" class="feedback-container" style="display:none;">
        <h1 style="text-align:center;margin-bottom:8px;">How was your experience?</h1>
        <p style="text-align:center;color:var(--muted);margin-bottom:32px;">at <strong id="restaurant-name"></strong></p>

        <div id="error-container"></div>

        <!-- Feedback to Restaurant -->
        <div class="feedback-section">
          <h2>Feedback for the Restaurant</h2>
          <p>Share your experience with the restaurant. What did they do well? What could be improved?</p>
          <textarea id="restaurant-feedback" class="feedback-textarea" placeholder="Optional: Share your thoughts about the food, service, or how they handled your dietary needs..."></textarea>
          <label class="checkbox-row">
            <input type="checkbox" id="restaurant-include-email">
            <span>Include my email so that restaurant management can follow up with me. Otherwise, comments will be shared anonymously.</span>
          </label>
        </div>

        <!-- Feedback for Website -->
        <div class="feedback-section">
          <h2>Feedback for Clarivore</h2>
          <p>Help us improve! Let us know about your experience using our service.</p>
          <textarea id="website-feedback" class="feedback-textarea" placeholder="Optional: How can we make Clarivore better for you?"></textarea>
          <label class="checkbox-row">
            <input type="checkbox" id="website-include-email">
            <span>Include my email so that website development can follow up with me. Otherwise, comments will be shared anonymously.</span>
          </label>
        </div>

        <!-- Menu with Accommodation Requests -->
        <div class="menu-section">
          <h2>Request Dish Accommodations</h2>
          <p>Click the checkbox on any dish that doesn't work for you to request the restaurant consider making it available for your dietary needs in the future.</p>

          <div id="menu-pages-container"></div>

          <div id="selected-dishes" class="selected-dishes" style="display:none;">
            <h3>Dishes you'd like accommodated:</h3>
            <div id="selected-dishes-list"></div>
          </div>
        </div>

        <!-- Submit Button -->
        <div class="submit-section">
          <button id="submit-btn" class="submit-btn">Submit Feedback</button>
        </div>
      </div>
    </div>
  </main>

`;
