"use client";

import { Button, Modal, Textarea } from "../../../components/ui";
import { CLARIVORE_LOGO_SRC } from "../../../components/clarivoreBrand";
import { asText } from "./editorUtils";
import { DishIngredientCard } from "./dishEditor/DishIngredientCard";
import { DishPreviewPanel } from "./dishEditor/DishPreviewPanel";
import { useDishEditorController } from "./dishEditor/useDishEditorController";

function DishEditorModal({
  editor,
  runtimeConfigHealth,
  saveIssueJumpRequest,
  onSaveIssueJumpHandled,
  confirmationGuide,
  onGuideBack,
  onGuideForward,
  onGuideCancel,
}) {
  // Data source: `editor` receives restaurant/menu state from RestaurantClient bootQuery (database-backed).
  const {
    overlay,
    showDeleteWarning,
    setShowDeleteWarning,
    recipeTextareaRef,
    aiActionsBlocked,
    runtimeBlockedTitle,
    allergens,
    diets,
    ingredients,
    existingBrandItems,
    previewAllergenRows,
    previewDietRows,
    applyBusyByRow,
    lastAppliedIngredientNameByRow,
    scanStateByRow,
    searchOpenRow,
    searchQueryByRow,
    appealOpenByRow,
    appealMessageByRow,
    appealPhotoByRow,
    appealPhotoErrorByRow,
    appealBusyByRow,
    appealFeedbackByRow,
    modalError,
    dictateActive,
    isIngredientGenerationBusy,
    isApplyingIngredientName,
    showPostProcessSections,
    handleCloseDishEditor,
    handleDictate,
    onProcessInput,
    updateIngredientName,
    applyIngredientSmartDetection,
    removeIngredientBrandItem,
    toggleIngredientSearchOpen,
    updateIngredientSearchQuery,
    applyExistingBrandItem,
    scanIngredientBrandItem,
    reviewIngredientScanResult,
    toggleIngredientAppealOpen,
    updateIngredientAppealMessage,
    handleAppealPhotoChange,
    clearAppealPhoto,
    submitIngredientAppeal,
    closeIngredientAppeal,
    toggleIngredientRemovable,
    cycleIngredientTokenState,
    toggleIngredientConfirmed,
    removeIngredientRow,
    addIngredientRow,
    setIngredientRowRef,
    setAssistImageFromFile,
  } = useDishEditorController({
    editor,
    runtimeConfigHealth,
    saveIssueJumpRequest,
    onSaveIssueJumpHandled,
  });

  return (
    <Modal
      open={editor.dishEditorOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCloseDishEditor();
        }
      }}
      className="restaurant-editor-dish-modal-shell"
      closeOnOverlay={false}
      closeOnEsc={false}
    >
      {!overlay ? (
        <p className="note">Select an overlay to edit.</p>
      ) : (
        <div className="restaurant-editor-dish-modal">
          {confirmationGuide ? (
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 5,
                marginBottom: 10,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(127,29,29,0.65)",
                  background: "rgba(76, 9, 9, 0.92)",
                }}
              >
                <span style={{ fontSize: "0.84rem", color: "#ffd0d0", fontWeight: 600 }}>
                  Confirming rows {confirmationGuide.currentIndex + 1} of {confirmationGuide.issues.length}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btnSmall"
                    disabled={!confirmationGuide.canBack}
                    onClick={onGuideBack}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btnSmall"
                    disabled={!confirmationGuide.canForward}
                    onClick={onGuideForward}
                  >
                    Forward
                  </button>
                  <button
                    type="button"
                    className="btn btnDanger btnSmall"
                    onClick={onGuideCancel}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="restaurant-editor-dish-head">
            <h2>Dish editor</h2>
            <div className="restaurant-editor-dish-head-actions">
              <button
                type="button"
                className="btn btnDanger"
                disabled={isApplyingIngredientName}
                onClick={() => setShowDeleteWarning(true)}
              >
                🗑 Delete
              </button>
              <button
                type="button"
                className="btn"
                disabled={isApplyingIngredientName}
                onClick={handleCloseDishEditor}
              >
                Done
              </button>
            </div>
          </div>

          <label className="restaurant-editor-dish-label">
            Dish name:
            <input
              className="restaurant-editor-dish-name-input"
              value={overlay.id || ""}
              placeholder="Item name"
              aria-label="Dish name"
              onChange={(event) =>
                editor.updateSelectedOverlay({
                  id: event.target.value,
                  name: event.target.value,
                })
              }
            />
          </label>

          <p className="restaurant-editor-dish-subcopy">
            Upload recipe photos or describe the dish ingredients below.
          </p>

          {/* Input capture supports either photos or free-form text. */}
          <div className="restaurant-editor-dish-media-row">
            <label className="btn" htmlFor="dish-editor-upload-photo">
              📁 Upload photos
            </label>
            <input
              id="dish-editor-upload-photo"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                await setAssistImageFromFile(file);
                event.target.value = "";
              }}
            />
            <label className="btn" htmlFor="dish-editor-take-photo">
              📷 Take photo
            </label>
            <input
              id="dish-editor-take-photo"
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                await setAssistImageFromFile(file);
                event.target.value = "";
              }}
            />
          </div>

          <div className="restaurant-editor-dish-or">OR</div>

          <div className="restaurant-editor-dish-text-wrap">
            <Textarea
              ref={recipeTextareaRef}
              rows={5}
              value={editor.aiAssistDraft.text}
              className="restaurant-editor-dish-textarea"
              onChange={(event) =>
                editor.setAiAssistDraft((current) => ({
                  ...current,
                  imageData: "",
                  text: event.target.value,
                }))
              }
            />
            <div className="restaurant-editor-dish-text-actions">
              <button
                type="button"
                className="btn"
                onClick={handleDictate}
              >
                {dictateActive ? "⏹ Stop dictation" : "🎙 Dictate"}
              </button>
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() =>
                  editor.setAiAssistDraft((current) => ({
                    ...current,
                    text:
                      current.text ||
                      `Create a generic recipe for ${overlay.id || overlay.name || "this dish"}.`,
                  }))
                }
              >
                ✨ Generate generic {overlay.id || "dish"} recipe
              </button>
            </div>
          </div>

          {editor.aiAssistDraft.error ? (
            <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
              {editor.aiAssistDraft.error}
            </p>
          ) : null}

          <div
            className={`restaurant-editor-dish-generation-wrap ${isIngredientGenerationBusy ? "is-processing" : ""}`}
          >
            <Button
              tone="success"
              loading={isIngredientGenerationBusy}
              disabled={aiActionsBlocked || isIngredientGenerationBusy}
              title={aiActionsBlocked ? runtimeBlockedTitle : ""}
              onClick={onProcessInput}
              className="restaurant-editor-dish-process-btn"
            >
              ✓ Process Input
            </Button>

            {!showPostProcessSections ? (
              <p className="note m-0 mt-2 text-sm">
                Add recipe text or a photo, then run <strong>Process Input</strong> to populate ingredient rows.
              </p>
            ) : null}

            {/* Ingredient cards isolate row-local controls while reusing shared modal handlers. */}
            {showPostProcessSections ? (
              <div className="restaurant-editor-dish-ingredients">
                <h3>Ingredients</h3>
                {ingredients.length ? (
                  <div className="restaurant-editor-dish-ingredient-list">
                    {ingredients.map((ingredient, index) => (
                      <DishIngredientCard
                        key={`ingredient-row-${index}`}
                        index={index}
                        ingredient={ingredient}
                        allergens={allergens}
                        diets={diets}
                        formatAllergenLabel={editor.config.formatAllergenLabel}
                        formatDietLabel={editor.config.formatDietLabel}
                        getDietAllergenConflicts={editor.config.getDietAllergenConflicts}
                        aiActionsBlocked={aiActionsBlocked}
                        runtimeBlockedTitle={runtimeBlockedTitle}
                        lastAppliedIngredientName={lastAppliedIngredientNameByRow[index]}
                        applyBusy={Boolean(applyBusyByRow[index])}
                        searchOpen={searchOpenRow === index}
                        searchQuery={searchQueryByRow[index] || ""}
                        appealOpen={Boolean(appealOpenByRow[index])}
                        appealMessage={String(appealMessageByRow[index] ?? "")}
                        appealPhoto={appealPhotoByRow[index] || null}
                        appealPhotoError={asText(appealPhotoErrorByRow[index])}
                        appealBusy={Boolean(appealBusyByRow[index])}
                        appealFeedback={appealFeedbackByRow[index]}
                        scanState={scanStateByRow[index] || {}}
                        existingBrandItems={existingBrandItems}
                        onRowRef={setIngredientRowRef}
                        onIngredientNameChange={updateIngredientName}
                        onApplySmartDetection={applyIngredientSmartDetection}
                        onRemoveBrandItem={removeIngredientBrandItem}
                        onToggleSearchOpen={toggleIngredientSearchOpen}
                        onSearchQueryChange={updateIngredientSearchQuery}
                        onApplyExistingBrandItem={applyExistingBrandItem}
                        onStartBrandScan={scanIngredientBrandItem}
                        onReviewBrandScan={reviewIngredientScanResult}
                        onToggleAppealOpen={toggleIngredientAppealOpen}
                        onAppealMessageChange={updateIngredientAppealMessage}
                        onAppealPhotoChange={handleAppealPhotoChange}
                        onAppealPhotoClear={clearAppealPhoto}
                        onSubmitAppeal={submitIngredientAppeal}
                        onCloseAppeal={closeIngredientAppeal}
                        onToggleRemovable={toggleIngredientRemovable}
                        onCycleTokenState={cycleIngredientTokenState}
                        onToggleConfirmed={toggleIngredientConfirmed}
                        onRemoveIngredient={removeIngredientRow}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="note m-0 text-sm">
                    Run <strong>Process Input</strong> to infer ingredient allergens and diets.
                  </p>
                )}

                {modalError ? (
                  <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                    {modalError}
                  </p>
                ) : null}

                <div className="restaurant-editor-dish-ingredient-actions">
                  <button type="button" className="btn btnSmall" onClick={addIngredientRow}>
                    Add ingredient
                  </button>
                </div>
              </div>
            ) : null}

            {/* Processing overlay blocks edits while AI updates row data. */}
            {isIngredientGenerationBusy ? (
              <div
                className="restaurant-editor-dish-generation-overlay"
                role="status"
                aria-live="polite"
              >
                <div className="restaurant-editor-dish-generation-overlay-stack">
                  <img
                    src={CLARIVORE_LOGO_SRC}
                    alt="Clarivore logo"
                    className="restaurant-editor-dish-generation-overlay-logo"
                  />
                  <span
                    className="restaurant-editor-dish-generation-overlay-spinner"
                    aria-hidden="true"
                  />
                  <span className="restaurant-editor-dish-generation-overlay-text">
                    Processing input and building ingredient rows...
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {showPostProcessSections ? (
            <DishPreviewPanel
              previewAllergenRows={previewAllergenRows}
              previewDietRows={previewDietRows}
            />
          ) : null}

          {/* Destructive action is isolated behind an explicit confirmation panel. */}
          {showDeleteWarning ? (
            <div id="editorDeleteWarning" style={{ display: "block", background: "#1a0a0a", border: "2px solid #dc2626", borderRadius: 8, padding: 20, margin: "16px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: "2rem" }}>🗑️</span>
                <div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>
                    Delete this dish?
                  </div>
                  <div style={{ fontSize: "0.95rem", color: "#d1d5db" }}>
                    This action cannot be undone.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  className="btn btnDanger"
                  disabled={isApplyingIngredientName}
                  style={{ flex: 1, padding: 12, fontSize: "1rem", background: "#dc2626", borderColor: "#b91c1c" }}
                  onClick={() => {
                    if (isApplyingIngredientName) return;
                    editor.removeOverlay(overlay._editorKey);
                    editor.closeDishEditor();
                  }}
                >
                  🗑 Delete
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1, padding: 12, fontSize: "1rem", background: "rgba(76,90,212,0.2)", borderColor: "rgba(76,90,212,0.4)" }}
                  onClick={() => setShowDeleteWarning(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="restaurant-editor-dish-footer-actions">
            <button
              type="button"
              className="btn"
              disabled={isApplyingIngredientName}
              onClick={handleCloseDishEditor}
            >
              Done
            </button>
          </div>

        </div>
      )}
    </Modal>
  );
}

export { DishEditorModal };
