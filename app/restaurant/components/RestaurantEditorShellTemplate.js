export default function RestaurantEditorShellTemplate() {
  return (
    <template id="editorWorkspaceTemplate">
      <div className="editorLayout">
        <div className="editorHeaderStack">
          <h1>Webpage editor</h1>
          <div className="editorHeaderRow">
            <div id="editorMiniMapSlot" className="editorMiniMapSlot" />
            <div className="editorControlColumn">
              <div className="editorToolbarScale" id="editorToolbarScale">
                <div className="editorToolbar" id="editorToolbar">
                  <div className="editorGroup">
                    <div className="editorGroupLabel">Editing</div>
                    <div className="editorGroupButtons">
                      <button className="btn btnPrimary" id="addBox">
                        + Add overlay
                      </button>
                      <button
                        className="btn"
                        id="undoBtn"
                        title="Undo (Ctrl+Z)"
                        style={{ opacity: 0.5 }}
                      >
                        ↶ Undo
                      </button>
                      <button
                        className="btn"
                        id="redoBtn"
                        title="Redo (Ctrl+Y)"
                        style={{ opacity: 0.5 }}
                      >
                        ↷ Redo
                      </button>
                      <button
                        className="btn btnPrimary editorSaveBtn"
                        id="saveBtn"
                        style={{ display: "none" }}
                      >
                        Save to site
                      </button>
                    </div>
                  </div>
                  <div className="editorGroup">
                    <div className="editorGroupLabel">Menu pages</div>
                    <div className="editorGroupButtons">
                      <button className="btn" id="uploadMenuBtn">
                        🗂️ Edit menu images
                      </button>
                      <button className="btn" id="viewLogBtn">
                        📋 View log of changes
                      </button>
                    </div>
                  </div>
                  <div className="editorGroup">
                    <div className="editorGroupLabel">Restaurant</div>
                    <div className="editorGroupButtons">
                      <button className="btn" id="settingsBtn">
                        ⚙️ Restaurant settings
                      </button>
                      <button className="btn btnDanger" id="confirmBtn">
                        Confirm information is up-to-date
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="editorNoteRow">
                <div
                  className="note"
                  id="editorNote"
                  style={{ margin: 0, flex: 1, minWidth: 220 }}
                >
                  Drag to move. Drag any corner to resize. Click ✏️ to edit
                  details.
                </div>
              </div>
            </div>
          </div>
          <div
            id="editorUnsavedWarning"
            style={{
              display: "none",
              background: "#2a1a0a",
              border: "2px solid #f59e0b",
              borderRadius: 8,
              padding: 20,
              margin: "16px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: "2rem" }}>⚠️</span>
              <div>
                <div
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 600,
                    color: "#f59e0b",
                    marginBottom: 4,
                  }}
                >
                  You have unsaved changes
                </div>
                <div style={{ fontSize: "0.95rem", color: "#d1d5db" }}>
                  Would you like to save before exiting?
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                className="btn btnPrimary"
                id="editorSaveAndExitBtn"
                style={{ flex: 1, padding: 12, fontSize: "1rem" }}
              >
                💾 Save Changes
              </button>
              <button
                type="button"
                className="btn"
                id="editorExitWithoutSavingBtn"
                style={{
                  flex: 1,
                  padding: 12,
                  fontSize: "1rem",
                  background: "#4a1a1a",
                  borderColor: "#721c24",
                }}
              >
                Exit Without Saving
              </button>
            </div>
            <button
              type="button"
              className="btn"
              id="editorCancelExitBtn"
              style={{
                width: "100%",
                marginTop: 12,
                padding: 8,
                fontSize: "0.9rem",
                background: "rgba(76,90,212,0.2)",
                borderColor: "rgba(76,90,212,0.4)",
              }}
            >
              Cancel
            </button>
          </div>
          <div
            id="detectedDishesPanel"
            style={{
              display: "none",
              background: "#1a2351",
              border: "1px solid #2a3261",
              borderRadius: 12,
              padding: 20,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <div
              style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: 8 }}
              id="currentDishName"
            />
            <div className="note" style={{ marginBottom: 12 }}>
              Press and drag on the menu to create an overlay for this item
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                alignItems: "center",
                fontSize: 14,
                flexWrap: "wrap",
              }}
            >
              <button
                className="btn"
                id="prevDishBtn"
                style={{ padding: "6px 12px", fontSize: 13 }}
              >
                ← Previous
              </button>
              <span id="dishProgress" style={{ color: "#a8b2d6" }} />
              <button
                className="btn"
                id="nextDishBtn"
                style={{ padding: "6px 12px", fontSize: 13 }}
              >
                Next →
              </button>
              <button
                className="btn btnSuccess"
                id="finishMappingBtn"
                style={{ padding: "6px 12px", fontSize: 13, display: "none" }}
              >
                ✓ Finish Mapping
              </button>
            </div>
          </div>
        </div>
        <div className="menuWrap show" id="menu" />
        <div
          id="menuTopNav"
          style={{
            display: "none",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            margin: "16px 0",
            padding: 12,
            background: "rgba(76,90,212,0.1)",
            borderRadius: 8,
          }}
        >
          <button className="btn" id="prevPageBtn" style={{ padding: "8px 16px" }}>
            ← Previous
          </button>
          <span id="pageIndicator" style={{ color: "#e9ecff", fontWeight: 600 }}>
            Page <span id="currentPageNum">1</span> of 1
          </span>
          <button className="btn" id="nextPageBtn" style={{ padding: "8px 16px" }}>
            Next →
          </button>
        </div>
      </div>
    </template>
  );
}
