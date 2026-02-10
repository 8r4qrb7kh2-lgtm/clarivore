const LEGACY_EDITOR_SHELL_HTML = `
<div class="editorLayout">
<div class="editorHeaderStack">
  <h1>Webpage editor</h1>
  <div class="editorHeaderRow">
    <div id="editorMiniMapSlot" class="editorMiniMapSlot"></div>
    <div class="editorControlColumn">
      <div class="editorToolbarScale" id="editorToolbarScale">
      <div class="editorToolbar" id="editorToolbar">
        <div class="editorGroup">
          <div class="editorGroupLabel">Editing</div>
          <div class="editorGroupButtons">
            <button class="btn btnPrimary" id="addBox">+ Add overlay</button>
            <button class="btn" id="undoBtn" title="Undo (Ctrl+Z)" style="opacity:0.5">↶ Undo</button>
            <button class="btn" id="redoBtn" title="Redo (Ctrl+Y)" style="opacity:0.5">↷ Redo</button>
            <button class="btn btnPrimary editorSaveBtn" id="saveBtn" style="display:none">Save to site</button>
          </div>
        </div>
        <div class="editorGroup">
          <div class="editorGroupLabel">Menu pages</div>
          <div class="editorGroupButtons">
            <button class="btn" id="uploadMenuBtn">🗂️ Edit menu images</button>
            <button class="btn" id="viewLogBtn">📋 View log of changes</button>
          </div>
        </div>
        <div class="editorGroup">
          <div class="editorGroupLabel">Restaurant</div>
          <div class="editorGroupButtons">
            <button class="btn" id="settingsBtn">⚙️ Restaurant settings</button>
            <button class="btn btnDanger" id="confirmBtn">Confirm information is up-to-date</button>
          </div>
        </div>
      </div>
      </div>
      <div class="editorNoteRow">
        <div class="note" id="editorNote" style="margin:0;flex:1;min-width:220px;">Drag to move. Drag any corner to resize. Click ✏️ to edit details.</div>
      </div>
    </div>
  </div>

  <div id="editorUnsavedWarning" style="display:none;background:#2a1a0a;border:2px solid #f59e0b;border-radius:8px;padding:20px;margin:16px 0">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
    <span style="font-size:2rem">⚠️</span>
    <div>
      <div style="font-size:1.1rem;font-weight:600;color:#f59e0b;margin-bottom:4px">You have unsaved changes</div>
      <div style="font-size:0.95rem;color:#d1d5db">Would you like to save before exiting?</div>
    </div>
  </div>
  <div style="display:flex;gap:12px">
    <button type="button" class="btn btnPrimary" id="editorSaveAndExitBtn" style="flex:1;padding:12px;font-size:1rem">💾 Save Changes</button>
    <button type="button" class="btn" id="editorExitWithoutSavingBtn" style="flex:1;padding:12px;font-size:1rem;background:#4a1a1a;border-color:#721c24">Exit Without Saving</button>
  </div>
  <button type="button" class="btn" id="editorCancelExitBtn" style="width:100%;margin-top:12px;padding:8px;font-size:0.9rem;background:rgba(76,90,212,0.2);border-color:rgba(76,90,212,0.4)">Cancel</button>
</div>

  <div id="detectedDishesPanel" style="display:none;background:#1a2351;border:1px solid #2a3261;border-radius:12px;padding:20px;margin-bottom:16px;text-align:center">
  <div style="font-size:1.3rem;font-weight:600;margin-bottom:8px" id="currentDishName"></div>
  <div class="note" style="margin-bottom:12px">Press and drag on the menu to create an overlay for this item</div>
  <div style="display:flex;gap:12px;justify-content:center;align-items:center;font-size:14px;flex-wrap:wrap">
    <button class="btn" id="prevDishBtn" style="padding:6px 12px;font-size:13px">← Previous</button>
    <span id="dishProgress" style="color:#a8b2d6"></span>
    <button class="btn" id="nextDishBtn" style="padding:6px 12px;font-size:13px">Next →</button>
    <button class="btn btnSuccess" id="finishMappingBtn" style="padding:6px 12px;font-size:13px;display:none">✓ Finish Mapping</button>
  </div>
</div>
</div>

<div class="menuWrap show" id="menu"></div>
<div id="menuTopNav" style="display:none;justify-content:center;align-items:center;gap:12px;margin:16px 0;padding:12px;background:rgba(76,90,212,0.1);border-radius:8px">
  <button class="btn" id="prevPageBtn" style="padding:8px 16px">← Previous</button>
  <span id="pageIndicator" style="color:#e9ecff;font-weight:600">Page <span id="currentPageNum">1</span> of 1</span>
  <button class="btn" id="nextPageBtn" style="padding:8px 16px">Next →</button>
</div>
</div>
`;

export function mountEditorShell(root) {
  if (!root) return;

  const template = document.getElementById("editorWorkspaceTemplate");
  if (
    typeof HTMLTemplateElement !== "undefined" &&
    template instanceof HTMLTemplateElement
  ) {
    root.replaceChildren(template.content.cloneNode(true));
    return;
  }

  root.innerHTML = LEGACY_EDITOR_SHELL_HTML;
}

