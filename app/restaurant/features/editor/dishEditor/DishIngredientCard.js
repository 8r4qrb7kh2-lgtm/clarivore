"use client";

import ConfirmToggleButton from "../../../../components/ingredient-scan/ConfirmToggleButton";
import {
  asText,
  normalizeToken,
  buildRowManualOverrideMessages,
  buildRowConflictMessages,
  readTokenState,
  getChipToneClass,
  getChipBorderClass,
} from "../editorUtils";

export function DishIngredientCard({
  index,
  ingredient,
  allergens,
  diets,
  formatAllergenLabel,
  formatDietLabel,
  getDietAllergenConflicts,
  aiActionsBlocked,
  runtimeBlockedTitle,
  lastAppliedIngredientName,
  applyBusy,
  searchOpen,
  searchQuery,
  appealOpen,
  appealMessage,
  appealPhoto,
  appealPhotoError,
  appealBusy,
  appealFeedback,
  scanState,
  existingBrandItems,
  onRowRef,
  onIngredientNameChange,
  onApplySmartDetection,
  onRemoveBrandItem,
  onToggleSearchOpen,
  onSearchQueryChange,
  onApplyExistingBrandItem,
  onStartBrandScan,
  onReviewBrandScan,
  onToggleAppealOpen,
  onAppealMessageChange,
  onAppealPhotoChange,
  onAppealPhotoClear,
  onSubmitAppeal,
  onCloseAppeal,
  onToggleRemovable,
  onCycleTokenState,
  onToggleConfirmed,
  onRemoveIngredient,
}) {
  // Keep name coercion stable so Apply button visibility is deterministic.
  const currentIngredientName =
    typeof ingredient?.name === "string"
      ? ingredient.name
      : ingredient?.name == null
        ? ""
        : String(ingredient.name);
  // Brand assignment drives confirmation gating and row warnings.
  const selectedBrandName = asText(ingredient?.brands?.[0]?.name);
  const selectedBrandImage = asText(
    ingredient?.brands?.[0]?.brandImage ||
      ingredient?.brands?.[0]?.image ||
      ingredient?.brands?.[0]?.ingredientsImage ||
      ingredient?.brandImage ||
      ingredient?.image ||
      ingredient?.ingredientsImage,
  );
  const hasAssignedBrand = Boolean(selectedBrandName);
  // Apply only appears after a true manual name change on rows without an assigned brand item.
  const showApplyButton =
    !hasAssignedBrand &&
    currentIngredientName !== (lastAppliedIngredientName ?? currentIngredientName);
  const requiresBrandBeforeConfirm =
    Boolean(ingredient?.brandRequired) && !hasAssignedBrand && ingredient?.confirmed !== true;

  // Manual override and conflict text are precomputed once per render for readability.
  const manualOverrideMessages = buildRowManualOverrideMessages({
    ingredient,
    allergens,
    diets,
    formatAllergenLabel,
    formatDietLabel,
  });
  const manualOverrideText = manualOverrideMessages.join("; ");
  const conflictMessages = buildRowConflictMessages({
    ingredient,
    allergens,
    diets,
    getDietAllergenConflicts,
    formatAllergenLabel,
    formatDietLabel,
  });
  const conflictWarningText = conflictMessages.join("; ");

  // Appeal photo may be stored as either an object payload or raw data URL.
  const appealPhotoDataUrl = asText(appealPhoto?.dataUrl || appealPhoto);
  const appealPhotoFileName = asText(appealPhoto?.fileName);
  const canSubmitAppeal =
    !appealBusy && String(appealMessage ?? "").trim().length > 0 && Boolean(appealPhotoDataUrl);

  // Scan state drives both button text and progress/error messaging.
  const scanPhase = asText(scanState?.phase);
  const scanMessage = asText(scanState?.message);
  const scanError = asText(scanState?.error);
  const hasReviewReady = scanPhase === "ready_for_review" || scanPhase === "review_open";
  const isScanProcessing = scanPhase === "processing";
  const isScanCapture = scanPhase === "capture_open";
  const scanButtonText = hasReviewReady
    ? "Review scan results"
    : isScanProcessing
      ? "Analyzing..."
      : isScanCapture
        ? "Capture open..."
        : "Add new item";
  const scanButtonDisabled = aiActionsBlocked || isScanProcessing || isScanCapture;

  // Existing brand suggestions exclude the current selection and honor row-level search.
  const searchTerm = asText(searchQuery).toLowerCase();
  const matchingBrands = (Array.isArray(existingBrandItems) ? existingBrandItems : [])
    .filter((brand) => {
      if (normalizeToken(brand.name) === normalizeToken(selectedBrandName)) {
        return false;
      }
      if (!searchTerm) return true;
      return brand.name.toLowerCase().includes(searchTerm);
    })
    .slice(0, 8);
  const isRowApplying = Boolean(applyBusy);

  return (
    <div
      className={`restaurant-editor-dish-ingredient-card ${isRowApplying ? "is-applying" : ""}`}
      aria-busy={isRowApplying || undefined}
      ref={(node) => {
        onRowRef(index, node);
      }}
    >
      <fieldset className="restaurant-editor-dish-ingredient-fieldset" disabled={isRowApplying}>
      <div className="restaurant-editor-dish-ingredient-main">
        <div className="restaurant-editor-dish-ingredient-name-col">
          <div className="restaurant-editor-dish-ingredient-name-row">
            <input
              className="restaurant-editor-dish-ingredient-name-input"
              value={ingredient.name}
              onChange={(event) => onIngredientNameChange(index, event.target.value)}
            />
            {showApplyButton ? (
              <button
                type="button"
                className="btn btnSmall btnWarning"
                disabled={Boolean(applyBusy)}
                onClick={() => onApplySmartDetection(index)}
              >
                {applyBusy ? "Applying..." : "Apply"}
              </button>
            ) : null}
          </div>

          <div
            className={`restaurant-editor-dish-ingredient-brand ${ingredient.brandRequired && !hasAssignedBrand ? "is-required" : ""}`}
          >
            {hasAssignedBrand ? (
              <span className="restaurant-editor-dish-ingredient-brand-selected">
                Selected: {selectedBrandName}
              </span>
            ) : null}
            {hasAssignedBrand && selectedBrandImage ? (
              <img
                src={selectedBrandImage}
                alt={`${selectedBrandName} thumbnail`}
                className="restaurant-editor-dish-ingredient-brand-thumb"
              />
            ) : null}
            {hasAssignedBrand ? (
              <div className="restaurant-editor-dish-ingredient-brand-actions">
                <button
                  type="button"
                  className="btn btnDanger btnSmall"
                  disabled={Boolean(applyBusy)}
                  onClick={() => onRemoveBrandItem(index)}
                >
                  {applyBusy ? "Removing..." : "Remove item"}
                </button>
              </div>
            ) : (
              <>
                <span>
                  {ingredient.brandRequired
                    ? "⚠ Brand assignment required"
                    : "✓ Brand assignment optional"}
                </span>
                {ingredient.brandRequirementReason ? (
                  <span className="restaurant-editor-dish-ingredient-brand-reason">
                    {ingredient.brandRequirementReason}
                  </span>
                ) : null}
                <div className="restaurant-editor-dish-ingredient-brand-actions">
                  <button
                    type="button"
                    className="btn btnSmall"
                    onClick={() => onToggleSearchOpen(index)}
                  >
                    Search existing items
                  </button>
                  <button
                    type="button"
                    className="btn btnSuccess btnSmall"
                    disabled={scanButtonDisabled}
                    title={aiActionsBlocked ? runtimeBlockedTitle : ""}
                    onClick={() => {
                      if (hasReviewReady) {
                        onReviewBrandScan(index);
                        return;
                      }
                      onStartBrandScan(index);
                    }}
                  >
                    {scanButtonText}
                  </button>
                  {ingredient.brandRequired ? (
                    <button
                      type="button"
                      className="btn btnDanger btnSmall"
                      onClick={() => onToggleAppealOpen(index)}
                    >
                      Submit appeal
                    </button>
                  ) : null}
                </div>
                {scanMessage ? (
                  <span
                    style={{
                      display: "block",
                      marginTop: 6,
                      color: scanError ? "#fecaca" : "#93c5fd",
                      fontSize: "0.78rem",
                    }}
                  >
                    {scanMessage}
                  </span>
                ) : null}
                {scanError ? (
                  <span
                    style={{
                      display: "block",
                      marginTop: 4,
                      color: "#fca5a5",
                      fontSize: "0.78rem",
                    }}
                  >
                    {scanError}
                  </span>
                ) : null}
                {searchOpen ? (
                  <div className="restaurant-editor-dish-brand-search">
                    <input
                      className="restaurant-editor-dish-brand-search-input"
                      value={searchQuery || ""}
                      placeholder="Search brand item names"
                      onChange={(event) => onSearchQueryChange(index, event.target.value)}
                    />
                    <div className="restaurant-editor-dish-brand-search-results">
                      {matchingBrands.length ? (
                        matchingBrands.map((brand) => (
                          <button
                            key={`${index}-${brand.name}`}
                            type="button"
                            className="restaurant-editor-dish-brand-search-result"
                            onClick={() => onApplyExistingBrandItem(index, brand)}
                          >
                            {brand.name}
                          </button>
                        ))
                      ) : (
                        <p className="restaurant-editor-dish-brand-search-empty">
                          No matching brand items in this menu.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
                {ingredient.brandRequired && appealOpen ? (
                  <div className="restaurant-editor-dish-appeal-wrap">
                    <textarea
                      className="restaurant-editor-dish-appeal-input"
                      placeholder="Briefly explain why this ingredient should not require brand assignment."
                      value={appealMessage}
                      onChange={(event) => onAppealMessageChange(index, event.target.value)}
                    />
                    <div className="restaurant-editor-dish-appeal-photo-row">
                      <label className="btn btnSmall" htmlFor={`appeal-photo-${index}`}>
                        {appealPhotoDataUrl ? "Replace photo" : "Take/upload photo"}
                      </label>
                      <input
                        id={`appeal-photo-${index}`}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="restaurant-editor-dish-appeal-photo-input"
                        onChange={(event) => onAppealPhotoChange(index, event.target.files?.[0] || null)}
                      />
                      {appealPhotoDataUrl ? (
                        <button
                          type="button"
                          className="btn btnSmall"
                          disabled={appealBusy}
                          onClick={() => onAppealPhotoClear(index)}
                        >
                          Remove photo
                        </button>
                      ) : null}
                    </div>
                    {appealPhotoDataUrl ? (
                      <div className="restaurant-editor-dish-appeal-photo-preview-wrap">
                        <img
                          src={appealPhotoDataUrl}
                          alt="Appeal evidence"
                          className="restaurant-editor-dish-appeal-photo-preview"
                        />
                        <span className="restaurant-editor-dish-appeal-photo-name">
                          {appealPhotoFileName || "Selected photo"}
                        </span>
                      </div>
                    ) : null}
                    {appealPhotoError ? (
                      <span className="restaurant-editor-dish-appeal-feedback is-error">
                        {appealPhotoError}
                      </span>
                    ) : null}
                    <div className="restaurant-editor-dish-appeal-actions">
                      <button
                        type="button"
                        className="btn btnSmall btnDanger"
                        disabled={!canSubmitAppeal}
                        onClick={() => onSubmitAppeal(index)}
                      >
                        {appealBusy ? "Submitting..." : "Send appeal"}
                      </button>
                      <button
                        type="button"
                        className="btn btnSmall"
                        disabled={appealBusy}
                        onClick={() => onCloseAppeal(index)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {appealFeedback?.message ? (
                  <span
                    className={`restaurant-editor-dish-appeal-feedback ${appealFeedback.tone === "success" ? "is-success" : "is-error"}`}
                  >
                    {appealFeedback.message}
                  </span>
                ) : null}
              </>
            )}
          </div>

          <label className="restaurant-editor-dish-inline-check">
            <input
              type="checkbox"
              checked={Boolean(ingredient.removable)}
              onChange={(event) => onToggleRemovable(index, event.target.checked)}
            />
            Can be removed/replaced
          </label>
        </div>

        {/* Detection key keeps tone/line style semantics discoverable while editing. */}
        <div className="restaurant-editor-dish-ingredient-flags">
          <div className="restaurant-editor-dish-detection-note">
            <div className="restaurant-editor-dish-detection-key-row">
              <span className="restaurant-editor-dish-key-box restaurant-editor-dish-key-box-solid" />
              <span>Contains</span>
              <span className="restaurant-editor-dish-key-box restaurant-editor-dish-key-box-dashed" />
              <span>Cross-contamination risk</span>
            </div>
            <div className="restaurant-editor-dish-detection-key-row">
              <span className="restaurant-editor-dish-key-dot restaurant-editor-dish-key-dot-smart" />
              <span>Smart detection</span>
              <span className="restaurant-editor-dish-key-dot restaurant-editor-dish-key-dot-manual" />
              <span>Manual override</span>
            </div>
          </div>
        </div>

        <div className="restaurant-editor-dish-ingredient-pills">
          <div className="restaurant-editor-dish-pill-column">
            {allergens.map((allergen) => {
              const selectedState = readTokenState({
                containsValues: ingredient.allergens,
                crossValues: ingredient.crossContaminationAllergens,
                token: allergen,
              });
              const smartState = readTokenState({
                containsValues: ingredient.aiDetectedAllergens,
                crossValues: ingredient.aiDetectedCrossContaminationAllergens,
                token: allergen,
              });
              const toneClass = getChipToneClass({
                selectedState,
                smartState,
              });
              const borderClass = getChipBorderClass(selectedState);
              return (
                <button
                  key={`${index}-allergen-${allergen}`}
                  type="button"
                  className={`restaurant-editor-dish-chip ${toneClass} ${borderClass}`}
                  onClick={() => onCycleTokenState(index, "allergen", allergen)}
                >
                  {formatAllergenLabel(allergen)}
                </button>
              );
            })}
          </div>
          <div className="restaurant-editor-dish-pill-column">
            {diets.map((diet) => {
              const selectedState = readTokenState({
                containsValues: ingredient.diets,
                crossValues: ingredient.crossContaminationDiets,
                token: diet,
              });
              const smartState = readTokenState({
                containsValues: ingredient.aiDetectedDiets,
                crossValues: ingredient.aiDetectedCrossContaminationDiets,
                token: diet,
              });
              const toneClass = getChipToneClass({
                selectedState,
                smartState,
              });
              const borderClass = getChipBorderClass(selectedState);
              return (
                <button
                  key={`${index}-diet-${diet}`}
                  type="button"
                  className={`restaurant-editor-dish-chip ${toneClass} ${borderClass}`}
                  onClick={() => onCycleTokenState(index, "diet", diet)}
                >
                  {formatDietLabel(diet)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="restaurant-editor-dish-ingredient-status-col">
          <ConfirmToggleButton
            confirmed={ingredient.confirmed === true}
            pendingLabel="Mark confirmed"
            confirmedLabel="Confirmed"
            disabled={requiresBrandBeforeConfirm}
            onClick={() => onToggleConfirmed(index)}
          />
        </div>
      </div>

      <div className="restaurant-editor-dish-ingredient-footer">
        <div className="restaurant-editor-dish-ingredient-meta">
          {manualOverrideText ? (
            <span className="restaurant-editor-dish-manual-warning">
              {manualOverrideText}
            </span>
          ) : null}
          {conflictWarningText ? (
            <span className="restaurant-editor-dish-conflict-warning">
              {conflictWarningText}
            </span>
          ) : null}
          {ingredient.brandRequired && !hasAssignedBrand ? (
            <span className="restaurant-editor-dish-brand-warning">
              Assign a brand item before marking this ingredient confirmed.
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btnDanger btnSmall"
          onClick={() => onRemoveIngredient(index)}
        >
          Delete
        </button>
      </div>
      </fieldset>
      {isRowApplying ? (
        <div
          className="restaurant-editor-dish-ingredient-apply-overlay"
          role="status"
          aria-live="polite"
        >
          <span
            className="restaurant-editor-dish-generation-overlay-spinner restaurant-editor-dish-ingredient-apply-spinner"
            aria-hidden="true"
          />
          <span className="restaurant-editor-dish-ingredient-apply-text">Applying...</span>
        </div>
      ) : null}
    </div>
  );
}
