export const dishEditorTemplate = () => `
    <div class="aiAssistPanel" id="aiAssistPanel" role="dialog" aria-modal="true" aria-labelledby="aiAssistTitle">
      <!-- Floating Replacement Progress Card -->
      <div id="aiAssistReplacementProgress" style="display:none;position:fixed;top:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg, #4c5ad4 0%, #5d6ae5 100%);border:2px solid rgba(76,90,212,0.8);border-radius:12px;padding:16px 24px;box-shadow:0 8px 24px rgba(0,0,0,0.4);z-index:10000;min-width:320px;max-width:90vw;text-align:center;white-space:nowrap">
        <div style="font-size:1.1rem;font-weight:600;color:#fff;margin-bottom:4px">Replace Removed Item</div>
        <div style="font-size:0.95rem;color:rgba(255,255,255,0.9)" id="aiAssistReplacementProgressText">Dish 1 of 3</div>
      </div>
      <div class="aiAssistHead">
        <div style="display:flex;align-items:center;gap:12px">
          <h2 id="aiAssistTitle" style="margin:0">Dish editor</h2>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btnDanger" id="aiAssistDeleteBtn" aria-label="Delete overlay" style="display:none;padding:8px 12px;font-size:0.9rem">🗑 Delete</button>
          <button type="button" class="aiAssistClose" id="aiAssistClose" aria-label="Close AI assistant">×</button>
        </div>
      </div>

      <!-- Unsaved Changes Warning -->
      <div id="aiAssistUnsavedWarning" style="display:none;background:#2a1a0a;border:2px solid #f59e0b;border-radius:8px;padding:20px;margin:16px 0">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <span style="font-size:2rem">⚠️</span>
          <div>
            <div style="font-size:1.1rem;font-weight:600;color:#f59e0b">You have unsaved work in the dish editor</div>
          </div>
        </div>
        <div style="display:flex;gap:12px">
          <button type="button" class="btn btnPrimary" id="aiAssistSaveAndExitBtn" style="flex:1;padding:12px;font-size:1rem">💾 Save Changes</button>
          <button type="button" class="btn" id="aiAssistExitWithoutSavingBtn" style="flex:1;padding:12px;font-size:1rem;background:#4a1a1a;border-color:#721c24">Exit Without Saving</button>
        </div>
        <button type="button" class="btn" id="aiAssistCancelExitBtn" style="width:100%;margin-top:12px;padding:8px;font-size:0.9rem;background:rgba(76,90,212,0.2);border-color:rgba(76,90,212,0.4)">Cancel</button>
      </div>

      <!-- Delete Overlay Warning -->
      <div id="aiAssistDeleteWarning" style="display:none;background:#1a0a0a;border:2px solid #dc2626;border-radius:8px;padding:20px;margin:16px 0">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <span style="font-size:2rem">🗑️</span>
          <div>
            <div style="font-size:1.1rem;font-weight:600;color:#dc2626;margin-bottom:4px">Delete this dish?</div>
            <div style="font-size:0.95rem;color:#d1d5db">This action cannot be undone.</div>
          </div>
        </div>
        <div style="display:flex;gap:12px">
          <button type="button" class="btn btnDanger" id="aiAssistConfirmDeleteBtn" style="flex:1;padding:12px;font-size:1rem;background:#dc2626;border-color:#b91c1c">🗑 Delete</button>
          <button type="button" class="btn" id="aiAssistCancelDeleteBtn" style="flex:1;padding:12px;font-size:1rem;background:rgba(76,90,212,0.2);border-color:rgba(76,90,212,0.4)">Cancel</button>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;position:relative">
        <label for="aiAssistNameInput" style="font-size:0.95rem;color:#a8b2d6;white-space:nowrap">Dish name:</label>
        <input type="text" id="aiAssistNameInput" placeholder="Enter dish name" style="flex:1;padding:10px;font-size:1rem;font-weight:600;border-radius:8px;border:1px solid rgba(76,90,212,0.35);background:rgba(10,16,36,0.95);color:var(--ink)">
        <button type="button" id="aiAssistSaveNameBtn" style="position:absolute;right:8px;padding:6px 12px;font-size:0.85rem;background:#4c5ad4;border-color:#4c5ad4;color:white;border-radius:6px;border:none;cursor:pointer;display:none;z-index:10">💾 Save</button>
      </div>
      <p class="aiAssistIntro">Upload recipe photos or describe the dish ingredients below.</p>

      <!-- Photo Upload Section -->
      <div class="aiAssistMedia" id="aiAssistMedia">
        <button type="button" class="btn" id="aiAssistUploadRecipeBtn" style="flex:1">📁 Upload photos</button>
        <button type="button" class="btn" id="aiAssistCameraRecipeBtn" style="flex:1">📷 Take photo</button>
        <input type="file" id="aiAssistRecipeFileInput" class="aiAssistHidden" accept="image/*" multiple>
      </div>

      <!-- Photo Previews Container -->
      <div id="aiAssistPhotosContainer" style="display:none;margin:16px 0;padding:12px;background:rgba(76,90,212,0.1);border:1px solid rgba(76,90,212,0.3);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:var(--ink)">Recipe Photos</strong>
          <button type="button" class="btn" id="aiAssistClearAllPhotosBtn" style="font-size:0.85rem;padding:4px 12px">Clear All</button>
        </div>
        <div id="aiAssistPhotosList" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
      </div>

      <div class="aiAssistMediaPreview" id="aiAssistMediaPreview">
        <video id="aiAssistVideo" class="aiAssistHidden" playsinline muted></video>
        <div class="aiAssistPhotoControls">
          <button type="button" class="btn" id="aiAssistCaptureBtn">Capture photo</button>
          <button type="button" class="btn" id="aiAssistCancelCameraBtn">Cancel camera</button>
        </div>
      </div>

      <!-- OR Divider -->
      <div style="display: flex; align-items: center; gap: 16px; margin: 20px 0;">
        <div style="flex: 1; height: 1px; background: rgba(76,90,212,0.3);"></div>
        <span style="color: #a0a0a0; font-weight: 600; font-size: 1rem;">OR</span>
        <div style="flex: 1; height: 1px; background: rgba(76,90,212,0.3);"></div>
      </div>

      <!-- Text Input Section -->
      <div style="position:relative;">
        <textarea id="aiAssistInput" class="aiAssistInput" placeholder="Example: Grilled chicken marinated in yogurt, lemon juice, garlic, served with toasted pita and tahini sauce."></textarea>
        <button type="button" class="btn" id="aiAssistDictateBtn" style="position:absolute;bottom:12px;left:12px;padding:6px 12px;font-size:0.9rem">🎙 Dictate</button>
        <button type="button" class="btn" id="aiAssistGenerateBtn" style="position:absolute;bottom:12px;right:12px;padding:6px 12px;font-size:0.9rem;background:#4c5ad4;border-color:#4c5ad4;color:white"></button>
      </div>

      <!-- Process Button -->
      <button type="button" class="btn" id="aiAssistProcessBtn" style="width:100%;margin-top:16px;padding:14px;font-size:1.1rem;font-weight:600;background:#2d7d46;border-color:#3a9d5a;color:white">
        ✓ Process Input
      </button>
      <span class="aiAssistStatus" id="aiAssistStatus" style="display:block;margin-top:8px;text-align:center"></span>
      <div class="aiProgressBar" id="aiProgressBar">
        <div class="aiProgressBarFill" id="aiProgressBarFill" style="width:0%"></div>
      </div>
      <div class="aiAssistResults" id="aiAssistResults" aria-live="polite">
        <h3 style="margin:0">Ingredients</h3>
        <div class="aiAssistTableWrapper">
          <table id="aiAssistTable">
            <tbody id="aiAssistTableBody"></tbody>
          </table>
        </div>

        <div class="aiAssistTableActions">
          <button type="button" class="btn" id="aiAssistAddRowBtn">Add ingredient</button>
        </div>

        <!-- Validation Error Message (shown when trying to save without confirming all ingredients) -->
        <div id="aiAssistSaveError" style="display:none;background:#2a1a0a;border:2px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:1.5rem">⚠️</span>
            <div>
              <div style="font-size:1rem;font-weight:600;color:#f59e0b;margin-bottom:4px">Cannot save - not all ingredients are confirmed</div>
              <div id="aiAssistSaveErrorDetails" style="font-size:0.9rem;color:#d1d5db"></div>
            </div>
          </div>
        </div>

        <div class="aiAssistTableActions" style="margin-top:20px;">
          <button type="button" class="btn btnPrimary" id="aiAssistApplyBtn">✓ Save to Dish</button>
        </div>

        <!-- Dish Overlay Preview -->
        <div id="aiAssistPreview" style="margin-top:24px;padding-top:24px;border-top:2px solid rgba(76,90,212,0.3)">
          <h3 style="margin:0 0 12px 0;font-size:1.1rem;color:#a8b2d6">Preview: What customers will see</h3>
          <div id="aiAssistPreviewBox" style="background:rgba(76,90,212,0.05);border:1px solid rgba(76,90,212,0.3);border-radius:8px;padding:16px;color:#d1d5db;font-size:0.95rem;line-height:1.6">
            <!-- Preview content will be inserted here -->
          </div>
        </div>

        <div class="aiAssistBrandResults" id="aiAssistBrandResults" aria-live="polite"></div>
      </div>
    </div>`;

export const imageModalTemplate = () => `
      <button type="button" class="closeModal" id="imageModalCloseBtn" aria-label="Close">×</button>
      <img id="imageModalImg" src="" alt="Full size image">
    `;
