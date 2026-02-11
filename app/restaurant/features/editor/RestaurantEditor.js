"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Modal, Textarea } from "../../../components/ui";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseOverlayNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(parsed, 0, 100);
}

function getVisibleSlice(imageNode, viewportNode) {
  if (!imageNode || !viewportNode) return null;
  const imageRect = imageNode.getBoundingClientRect();
  const viewportRect = viewportNode.getBoundingClientRect();
  if (imageRect.height <= 0 || viewportRect.height <= 0) return null;

  const visibleTop = Math.max(imageRect.top, viewportRect.top);
  const visibleBottom = Math.min(imageRect.bottom, viewportRect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const offsetTop = Math.max(0, visibleTop - imageRect.top);

  return {
    offsetTop,
    visibleHeight,
    imageHeight: imageRect.height,
  };
}

async function fileToDataUrl(file) {
  if (!file) return "";
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function parseChangePayload(log) {
  if (!log?.changes) return null;
  if (typeof log.changes === "object") return log.changes;
  if (typeof log.changes !== "string") return null;
  try {
    return JSON.parse(log.changes);
  } catch {
    return null;
  }
}

function hasChangeSnapshot(log) {
  const parsed = parseChangePayload(log);
  return Boolean(
    parsed?.snapshot ||
      parsed?.__editorSnapshot ||
      (parsed?.meta && parsed.meta.snapshot),
  );
}

function formatLogTimestamp(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildAllergenDisplay(editor, overlay) {
  const configured = Array.isArray(editor.config?.allergens)
    ? editor.config.allergens
    : [];
  const fallback = Array.isArray(overlay?.allergens) ? overlay.allergens : [];
  const union = [...configured, ...fallback];
  const seen = new Set();
  return union.filter((item) => {
    const key = asText(item);
    if (!key) return false;
    const token = normalizeToken(key);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function buildDietDisplay(editor, overlay) {
  const configured = Array.isArray(editor.config?.diets) ? editor.config.diets : [];
  const fallback = Array.isArray(overlay?.diets) ? overlay.diets : [];
  const union = [...configured, ...fallback];
  const seen = new Set();
  return union.filter((item) => {
    const key = asText(item);
    if (!key) return false;
    const token = normalizeToken(key);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function readAllergenDetail(overlay, allergen) {
  const key = asText(allergen);
  if (!key) return "";
  if (!overlay?.details || typeof overlay.details !== "object") return "";

  const target = normalizeToken(key);
  for (const [detailKey, detailValue] of Object.entries(overlay.details)) {
    if (normalizeToken(detailKey) === target) {
      return asText(detailValue);
    }
  }
  return "";
}

function hasRemovable(overlay, allergen) {
  const list = Array.isArray(overlay?.removable) ? overlay.removable : [];
  const token = normalizeToken(allergen);
  return list.some((item) => normalizeToken(item?.allergen) === token);
}

function hasCrossContamination(overlay, allergen) {
  const list = Array.isArray(overlay?.crossContamination)
    ? overlay.crossContamination
    : [];
  const token = normalizeToken(allergen);
  return list.some((item) => normalizeToken(item) === token);
}

function DishEditorModal({ editor }) {
  const overlay = editor.selectedOverlay;
  const [showDeleteWarning, setShowDeleteWarning] = useState(false);

  const allergens = useMemo(
    () => buildAllergenDisplay(editor, overlay),
    [editor, overlay],
  );

  const diets = useMemo(() => buildDietDisplay(editor, overlay), [editor, overlay]);

  useEffect(() => {
    if (!editor.dishEditorOpen) {
      setShowDeleteWarning(false);
      editor.setDishAiAssistOpen(false);
    }
  }, [editor]);

  return (
    <Modal
      open={editor.dishEditorOpen}
      onOpenChange={(open) => {
        if (!open) {
          editor.pushHistory();
          editor.closeDishEditor();
        }
      }}
      title="Edit item"
      className="max-w-[980px]"
    >
      {!overlay ? (
        <p className="note">Select an overlay to edit.</p>
      ) : (
        <div className="space-y-3">
          <div className="algRow" style={{ gridTemplateColumns: "1fr" }}>
            <input
              className="algInput"
              style={{ fontWeight: 700 }}
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
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm text-[#bdd0ff]">
              Description
              <Input
                value={overlay.description || ""}
                onChange={(event) =>
                  editor.updateSelectedOverlay({ description: event.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-sm text-[#bdd0ff]">
              Notes
              <Input
                value={asText(overlay.details?.__notes)}
                onChange={(event) =>
                  editor.updateSelectedOverlay({
                    details: {
                      ...(overlay.details || {}),
                      __notes: event.target.value,
                    },
                  })
                }
              />
            </label>
          </div>

          <div>
            <h3 style={{ margin: "0 0 12px", color: "var(--ink)" }}>
              Allergen Information
            </h3>
            <div className="space-y-2">
              {allergens.map((allergen) => {
                const active = Array.isArray(overlay.allergens)
                  ? overlay.allergens.some(
                      (item) => normalizeToken(item) === normalizeToken(allergen),
                    )
                  : false;
                return (
                  <div key={allergen} className="rounded-lg border border-[#2a3261] bg-[rgba(12,18,44,0.7)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={`algBtn ${active ? "active" : ""}`}
                        onClick={() => editor.toggleSelectedAllergen(allergen)}
                      >
                        {editor.config.formatAllergenLabel(allergen)}
                      </button>

                      {active ? (
                        <label className="algChk">
                          <input
                            type="checkbox"
                            checked={hasRemovable(overlay, allergen)}
                            onChange={(event) =>
                              editor.setSelectedAllergenRemovable(
                                allergen,
                                event.target.checked,
                              )
                            }
                          />
                          can be substituted out
                        </label>
                      ) : null}

                      <label className="algChk">
                        <input
                          type="checkbox"
                          checked={hasCrossContamination(overlay, allergen)}
                          onChange={(event) =>
                            editor.setSelectedAllergenCrossContamination(
                              allergen,
                              event.target.checked,
                            )
                          }
                        />
                        cross-contamination risk
                      </label>
                    </div>

                    {active ? (
                      <input
                        className="algInput mt-2"
                        placeholder="Which part of the dish contains the allergen?"
                        value={readAllergenDetail(overlay, allergen)}
                        onChange={(event) =>
                          editor.setSelectedAllergenDetail(allergen, event.target.value)
                        }
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 style={{ margin: "18px 0 10px", color: "var(--ink)" }}>
              Dietary Preferences
            </h3>
            <div className="flex flex-wrap gap-2">
              {diets.map((diet) => {
                const active = Array.isArray(overlay.diets)
                  ? overlay.diets.some((item) => normalizeToken(item) === normalizeToken(diet))
                  : false;
                return (
                  <button
                    key={diet}
                    type="button"
                    className={`algBtn ${active ? "active" : ""}`}
                    onClick={() => editor.toggleSelectedDiet(diet)}
                  >
                    {editor.config.formatDietLabel(diet)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-[#2a3261] bg-[rgba(12,18,44,0.5)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-[#e7edff]">AI ingredient helper</h3>
              <div className="flex gap-2">
                <Button
                  size="compact"
                  variant="outline"
                  onClick={() => editor.setDishAiAssistOpen(true)}
                >
                  Open helper
                </Button>
                <Button
                  size="compact"
                  variant="outline"
                  onClick={async () => {
                    await editor.runIngredientLabelScan();
                  }}
                >
                  Scan ingredient label
                </Button>
              </div>
            </div>
            <p className="m-0 text-xs text-[#a7b2d1]">
              Use AI to infer allergens/diets from text or ingredient labels and apply results to this dish.
            </p>
          </div>

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
                  style={{ flex: 1, padding: 12, fontSize: "1rem", background: "#dc2626", borderColor: "#b91c1c" }}
                  onClick={() => {
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

          <div className="editorActionRow" style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              className="btn btnPrimary"
              onClick={() => {
                editor.pushHistory();
                editor.closeDishEditor();
              }}
            >
              Done
            </button>
            <button className="btn btnDanger" onClick={() => setShowDeleteWarning(true)}>
              Delete overlay
            </button>
          </div>
        </div>
      )}

      <Modal
        open={editor.dishAiAssistOpen}
        onOpenChange={(open) => {
          editor.setDishAiAssistOpen(open);
        }}
        title="AI Ingredient Helper"
        className="max-w-[820px]"
      >
        <div className="space-y-3">
          <p className="note m-0 text-sm">
            Describe the dish or upload a label/menu image. AI results can be applied directly to this dish.
          </p>

          <label className="space-y-1 text-sm text-[#bdd0ff] block">
            Description / ingredients
            <Textarea
              rows={5}
              value={editor.aiAssistDraft.text}
              onChange={(event) =>
                editor.setAiAssistDraft((current) => ({
                  ...current,
                  text: event.target.value,
                }))
              }
            />
          </label>

          <div className="flex items-center gap-3">
            <label className="btn" htmlFor="dish-ai-image-input">
              Upload image
            </label>
            <input
              id="dish-ai-image-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const imageData = await fileToDataUrl(file);
                editor.setAiAssistDraft((current) => ({
                  ...current,
                  imageData,
                }));
                event.target.value = "";
              }}
            />
            {editor.aiAssistDraft.imageData ? (
              <span className="text-xs text-[#a7b2d1]">Image attached</span>
            ) : (
              <span className="text-xs text-[#a7b2d1]">No image attached</span>
            )}
          </div>

          {editor.aiAssistDraft.error ? (
            <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
              {editor.aiAssistDraft.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              size="compact"
              tone="primary"
              loading={editor.aiAssistDraft.loading}
              onClick={editor.runAiDishAnalysis}
            >
              Analyze
            </Button>
            <Button
              size="compact"
              variant="outline"
              onClick={() => editor.setDishAiAssistOpen(false)}
            >
              Close
            </Button>
          </div>

          {editor.aiAssistDraft.result ? (
            <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3">
              <p className="m-0 mb-2 text-sm text-[#dbe3ff]">
                Detected diets: {Array.isArray(editor.aiAssistDraft.result.dietaryOptions)
                  ? editor.aiAssistDraft.result.dietaryOptions.join(", ") || "None"
                  : "None"}
              </p>
              <ul className="m-0 list-disc pl-5 text-sm text-[#c9d4f2]">
                {(Array.isArray(editor.aiAssistDraft.result.ingredients)
                  ? editor.aiAssistDraft.result.ingredients
                  : []
                ).map((ingredient, index) => (
                  <li key={`${ingredient?.name || "ing"}-${index}`}>
                    <strong>{ingredient?.name || "Ingredient"}</strong>
                    {Array.isArray(ingredient?.allergens) && ingredient.allergens.length
                      ? ` · allergens: ${ingredient.allergens.join(", ")}`
                      : " · no allergens flagged"}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button
                  size="compact"
                  tone="success"
                  onClick={() => {
                    editor.applyAiResultToSelectedOverlay(editor.aiAssistDraft.result);
                    editor.setDishAiAssistOpen(false);
                  }}
                >
                  Apply to dish
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </Modal>
  );
}

function ChangeLogModal({ editor }) {
  return (
    <Modal
      open={editor.changeLogOpen}
      onOpenChange={(open) => editor.setChangeLogOpen(open)}
      title="Change Log"
      className="max-w-[860px]"
    >
      {editor.loadingChangeLogs ? (
        <p className="note">Loading change log...</p>
      ) : editor.changeLogError ? (
        <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
          {editor.changeLogError}
        </p>
      ) : !editor.changeLogs.length ? (
        <p className="note">No changes recorded yet.</p>
      ) : (
        <div className="space-y-3 max-h-[65vh] overflow-auto pr-1">
          {editor.changeLogs.map((log) => {
            const parsed = parseChangePayload(log);
            const items = parsed?.items && typeof parsed.items === "object" ? parsed.items : {};
            const general = Array.isArray(parsed?.general) ? parsed.general : [];

            return (
              <div key={log.id || `${log.timestamp}-${log.type}`} className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#e9eefc]">
                    {parsed?.author || log.description || "Manager"}
                  </span>
                  <span className="text-xs text-[#a7b2d1]">{formatLogTimestamp(log.timestamp)}</span>
                </div>

                {general.length ? (
                  <ul className="mt-2 mb-0 list-disc pl-5 text-sm text-[#cfd8f7]">
                    {general.map((line, index) => (
                      <li key={`${log.id}-general-${index}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}

                {Object.entries(items).map(([dishName, changes]) => (
                  <div key={`${log.id}-${dishName}`} className="mt-2">
                    <div className="text-sm font-medium text-[#dbe3ff]">{dishName}</div>
                    <ul className="mb-0 mt-1 list-disc pl-5 text-sm text-[#c7d2f4]">
                      {(Array.isArray(changes) ? changes : []).map((line, idx) => (
                        <li key={`${log.id}-${dishName}-${idx}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}

                {Array.isArray(log.photos) && log.photos.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {log.photos.map((photo, index) => (
                      <a
                        key={`${log.id}-photo-${index}`}
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={photo}
                          alt={`Change log photo ${index + 1}`}
                          className="h-[64px] w-[96px] rounded border border-[#2a3261] object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}

                {hasChangeSnapshot(log) ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="compact"
                      tone="primary"
                      onClick={() => editor.restoreFromChangeLog(log)}
                    >
                      Restore this version
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function ConfirmInfoModal({ editor }) {
  const [photos, setPhotos] = useState([]);
  const [step, setStep] = useState("capture");

  useEffect(() => {
    if (!editor.confirmInfoOpen) {
      setPhotos([]);
      setStep("capture");
    }
  }, [editor.confirmInfoOpen]);

  const addFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const values = [];
    for (const file of list) {
      // eslint-disable-next-line no-await-in-loop
      const url = await fileToDataUrl(file);
      if (url) values.push(url);
    }
    if (values.length) {
      setPhotos((current) => [...current, ...values]);
    }
  };

  return (
    <Modal
      open={editor.confirmInfoOpen}
      onOpenChange={(open) => editor.setConfirmInfoOpen(open)}
      title="Confirm Allergen Information"
      className="max-w-[820px]"
    >
      <div className="space-y-3">
        <p className="note m-0 text-sm">
          Take photos of your current menu to confirm that it aligns with the menu on Clarivore.
        </p>

        <div className="flex items-center gap-2">
          <label className="btn" htmlFor="confirm-photos-input">
            Upload photos
          </label>
          <input
            id="confirm-photos-input"
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={async (event) => {
              await addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="text-xs text-[#a7b2d1]">{photos.length} photo(s)</span>
        </div>

        {photos.length ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <div key={`confirm-photo-${index}`} className="relative">
                <img
                  src={photo}
                  alt={`Menu confirmation ${index + 1}`}
                  className="h-[72px] w-[110px] rounded border border-[#2a3261] object-cover"
                />
                <button
                  type="button"
                  className="btn btnDanger"
                  style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 22,
                    height: 22,
                    minWidth: 22,
                    padding: 0,
                    borderRadius: "50%",
                  }}
                  onClick={() =>
                    setPhotos((current) => current.filter((_, i) => i !== index))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {step === "capture" ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            Are all dishes clearly visible in these photos?
            <div className="mt-2 flex gap-2">
              <Button size="compact" tone="success" onClick={() => setStep("current")}>✓ Yes</Button>
              <Button
                size="compact"
                tone="danger"
                onClick={() => {
                  setPhotos([]);
                  setStep("capture");
                }}
              >
                ✗ No
              </Button>
            </div>
          </div>
        ) : null}

        {step === "current" ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            Are these photos of your most current menu?
            <div className="mt-2 flex gap-2">
              <Button
                size="compact"
                tone="success"
                loading={editor.confirmBusy}
                onClick={async () => {
                  const result = await editor.confirmInfo(photos);
                  if (result?.success) {
                    editor.setConfirmInfoOpen(false);
                  }
                }}
              >
                ✓ Yes, confirm
              </Button>
              <Button
                size="compact"
                tone="danger"
                onClick={() => editor.setConfirmInfoOpen(false)}
              >
                ✗ Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {editor.confirmError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.confirmError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function MenuPagesModal({ editor }) {
  const replaceInputsRef = useRef({});
  const addInputRef = useRef(null);

  return (
    <Modal
      open={editor.menuPagesOpen}
      onOpenChange={(open) => editor.setMenuPagesOpen(open)}
      title="Edit menu images"
      className="max-w-[960px]"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="compact"
            tone="primary"
            onClick={() => addInputRef.current?.click()}
          >
            Add page
          </Button>
          <input
            ref={addInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const image = await fileToDataUrl(file);
              editor.addMenuPage(image);
              event.target.value = "";
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {editor.draftMenuImages.map((image, index) => (
            <div
              key={`menu-page-${index}`}
              className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.8)] p-2"
            >
              <div className="rounded-lg border border-[#2a3261] bg-[#070b16] p-1">
                {image ? (
                  <img
                    src={image}
                    alt={`Menu page ${index + 1}`}
                    className="h-[180px] w-full rounded object-contain"
                  />
                ) : (
                  <div className="flex h-[180px] items-center justify-center text-xs text-[#9ea9c8]">
                    No image
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-[#c4cfec]">Page {index + 1}</span>
                <div className="flex gap-2">
                  <Button
                    size="compact"
                    variant="outline"
                    onClick={() => replaceInputsRef.current[index]?.click()}
                  >
                    Replace
                  </Button>
                  {editor.draftMenuImages.length > 1 ? (
                    <Button
                      size="compact"
                      tone="danger"
                      variant="outline"
                      onClick={() => editor.removeMenuPage(index)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={(node) => {
                    replaceInputsRef.current[index] = node;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const imageData = await fileToDataUrl(file);
                    editor.replaceMenuPage(index, imageData);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function RestaurantSettingsModal({ editor }) {
  return (
    <Modal
      open={editor.restaurantSettingsOpen}
      onOpenChange={(open) => editor.setRestaurantSettingsOpen(open)}
      title="Restaurant settings"
      className="max-w-[720px]"
    >
      <div className="space-y-3">
        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Website
          <Input
            value={editor.restaurantSettingsDraft.website || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                website: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Phone
          <Input
            value={editor.restaurantSettingsDraft.phone || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                phone: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Delivery URL
          <Input
            value={editor.restaurantSettingsDraft.delivery_url || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                delivery_url: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Menu URL
          <Input
            value={editor.restaurantSettingsDraft.menu_url || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                menu_url: event.target.value,
              }))
            }
          />
        </label>

        {editor.settingsSaveError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.settingsSaveError}
          </p>
        ) : null}

        <div className="flex gap-2 justify-end">
          <Button
            size="compact"
            variant="outline"
            onClick={() => editor.setRestaurantSettingsOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={editor.settingsSaveBusy}
            onClick={async () => {
              const result = await editor.saveRestaurantSettings();
              if (result?.success) {
                editor.setRestaurantSettingsOpen(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function RestaurantEditor({ editor }) {
  const menuScrollRef = useRef(null);
  const pageRefs = useRef([]);
  const pageImageRefs = useRef([]);
  const overlayInteractionRef = useRef(null);
  const mappingDragRef = useRef(null);

  const [scrollSnapshot, setScrollSnapshot] = useState({
    scrollTop: 0,
    clientHeight: 1,
    scrollHeight: 1,
  });
  const [mappedRectPreview, setMappedRectPreview] = useState(null);

  const overlayCountLabel = `${editor.draftOverlays.length} overlay${editor.draftOverlays.length === 1 ? "" : "s"}`;

  const detectDishes = editor.detectWizardState.dishes || [];
  const mappedCount = detectDishes.filter((dish) => dish.mapped).length;
  const allMapped = detectDishes.length > 0 && mappedCount >= detectDishes.length;
  const currentWizardDish = detectDishes[editor.detectWizardState.currentIndex] || null;
  const mappingEnabled =
    editor.detectWizardOpen &&
    !editor.detectWizardState.loading &&
    Boolean(currentWizardDish) &&
    !allMapped;

  const refreshScrollSnapshot = useCallback(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return;

    const next = {
      scrollTop: scrollNode.scrollTop,
      clientHeight: Math.max(scrollNode.clientHeight, 1),
      scrollHeight: Math.max(scrollNode.scrollHeight, 1),
    };

    setScrollSnapshot((current) => {
      if (
        current.scrollTop === next.scrollTop &&
        current.clientHeight === next.clientHeight &&
        current.scrollHeight === next.scrollHeight
      ) {
        return current;
      }
      return next;
    });

    let bestPage = editor.activePageIndex;
    let bestVisible = 0;
    pageImageRefs.current.forEach((imageNode, index) => {
      const slice = getVisibleSlice(imageNode, scrollNode);
      const visible = slice?.visibleHeight || 0;
      if (visible > bestVisible) {
        bestVisible = visible;
        bestPage = index;
      }
    });

    if (bestPage !== editor.activePageIndex) {
      editor.jumpToPage(bestPage);
    }
  }, [editor]);

  useEffect(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return undefined;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshScrollSnapshot();
      });
    };

    schedule();
    scrollNode.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : null;

    if (resizeObserver) {
      resizeObserver.observe(scrollNode);
      pageRefs.current.forEach((node) => node && resizeObserver.observe(node));
      pageImageRefs.current.forEach((node) => node && resizeObserver.observe(node));
    }

    return () => {
      scrollNode.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (resizeObserver) resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [refreshScrollSnapshot, editor.overlaysByPage.length]);

  useEffect(() => {
    const imageNodes = pageImageRefs.current.filter(Boolean);
    if (!imageNodes.length) return undefined;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshScrollSnapshot();
      });
    };

    imageNodes.forEach((node) => {
      node.addEventListener("load", schedule);
      if (node.complete) schedule();
    });

    return () => {
      imageNodes.forEach((node) => node.removeEventListener("load", schedule));
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [editor.overlaysByPage, refreshScrollSnapshot]);

  const minimapViewport = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    const pageNode =
      pageImageRefs.current[editor.activePageIndex] ||
      pageRefs.current[editor.activePageIndex];
    if (!scrollNode || !pageNode) {
      return { topRatio: 0, heightRatio: 0.2 };
    }

    const slice = getVisibleSlice(pageNode, scrollNode);
    if (slice && slice.visibleHeight > 0) {
      const topRatio = clamp(slice.offsetTop / slice.imageHeight, 0, 1);
      const heightRatio = clamp(slice.visibleHeight / slice.imageHeight, 0.03, 1);
      return {
        topRatio: clamp(topRatio, 0, Math.max(1 - heightRatio, 0)),
        heightRatio,
      };
    }

    const pageHeight = Math.max(pageNode.offsetHeight, 1);
    const pageTop = pageNode.offsetTop;
    const viewportTop = scrollSnapshot.scrollTop;
    const viewportBottom = viewportTop + scrollSnapshot.clientHeight;
    const visibleTop = clamp(viewportTop - pageTop, 0, pageHeight);
    const visibleBottom = clamp(viewportBottom - pageTop, 0, pageHeight);
    const visibleHeight = Math.max(visibleBottom - visibleTop, 0);

    const topRatio = clamp(visibleTop / pageHeight, 0, 1);
    const heightRatio = clamp(visibleHeight / pageHeight, 0.03, 1);

    return {
      topRatio: clamp(topRatio, 0, Math.max(1 - heightRatio, 0)),
      heightRatio,
    };
  }, [editor.activePageIndex, scrollSnapshot.clientHeight, scrollSnapshot.scrollTop]);

  const scrollToPage = useCallback(
    (pageIndex, behavior = "smooth") => {
      const index = clamp(
        Number(pageIndex) || 0,
        0,
        Math.max(editor.overlaysByPage.length - 1, 0),
      );
      const node = pageRefs.current[index];
      const scrollNode = menuScrollRef.current;
      if (!node || !scrollNode) return;

      editor.jumpToPage(index);
      scrollNode.scrollTo({ top: node.offsetTop, behavior });
    },
    [editor],
  );

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      const pageNode =
        pageImageRefs.current[editor.activePageIndex] ||
        pageRefs.current[editor.activePageIndex];
      if (!scrollNode || !pageNode) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const pageHeight = Math.max(pageNode.offsetHeight, 1);
      const maxScroll = Math.max(scrollNode.scrollHeight - scrollNode.clientHeight, 0);
      const targetWithinPage = ratio * pageHeight - scrollNode.clientHeight / 2;
      const target = pageNode.offsetTop + targetWithinPage;

      scrollNode.scrollTo({ top: clamp(target, 0, maxScroll), behavior: "smooth" });
    },
    [editor.activePageIndex],
  );

  const getOverlaySnapTargets = useCallback(
    (pageIndex, overlayKey) => {
      const page = editor.overlaysByPage[pageIndex];
      if (!page) {
        return { xEdges: [], yEdges: [] };
      }

      const xEdges = [];
      const yEdges = [];
      page.overlays.forEach((overlay) => {
        if (overlay._editorKey === overlayKey) return;
        const x = parseOverlayNumber(overlay.x);
        const y = parseOverlayNumber(overlay.y);
        const w = parseOverlayNumber(overlay.w);
        const h = parseOverlayNumber(overlay.h);
        xEdges.push(x, x + w);
        yEdges.push(y, y + h);
      });

      return { xEdges, yEdges };
    },
    [editor.overlaysByPage],
  );

  const snapValue = (value, targets, threshold) => {
    for (const target of targets) {
      if (Math.abs(value - target) < threshold) {
        return target;
      }
    }
    return value;
  };

  const stopOverlayInteraction = useCallback((changeLabel) => {
    const interaction = overlayInteractionRef.current;
    if (!interaction) return;

    window.removeEventListener("pointermove", interaction.onMove);
    window.removeEventListener("pointerup", interaction.onUp);
    overlayInteractionRef.current = null;

    if (interaction.overlayName) {
      editor.updateOverlay(
        interaction.overlayKey,
        (overlay) => overlay,
        {
          changeText:
            changeLabel || `${interaction.overlayName}: Adjusted overlay position`,
          recordHistory: true,
        },
      );
    }
  }, [editor]);

  const startDragOverlay = useCallback(
    (event, overlay, pageIndex) => {
      if (mappingEnabled) return;
      if (!overlay?._editorKey) return;
      if (event.button !== 0) return;
      if (event.target.closest(".handle") || event.target.closest(".editBadge")) return;

      event.preventDefault();
      editor.selectOverlay(overlay._editorKey);

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const pageRect = pageNode.getBoundingClientRect();

      const start = {
        x: event.clientX,
        y: event.clientY,
        left: parseOverlayNumber(overlay.x),
        top: parseOverlayNumber(overlay.y),
      };

      const onMove = (moveEvent) => {
        const dx = ((moveEvent.clientX - start.x) / Math.max(pageRect.width, 1)) * 100;
        const dy = ((moveEvent.clientY - start.y) / Math.max(pageRect.height, 1)) * 100;

        const width = parseOverlayNumber(overlay.w);
        const height = parseOverlayNumber(overlay.h);

        const nextX = clamp(start.left + dx, 0, 100 - width);
        const nextY = clamp(start.top + dy, 0, 100 - height);

        editor.updateOverlay(overlay._editorKey, {
          x: nextX,
          y: nextY,
        });
      };

      const onUp = () => {
        stopOverlayInteraction(`${overlay.id || "Dish"}: Adjusted overlay position`);
      };

      overlayInteractionRef.current = {
        overlayKey: overlay._editorKey,
        overlayName: overlay.id || "Dish",
        onMove,
        onUp,
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, mappingEnabled, stopOverlayInteraction],
  );

  const startResizeOverlay = useCallback(
    (event, overlay, pageIndex, corner) => {
      if (mappingEnabled) return;
      if (!overlay?._editorKey) return;
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      editor.selectOverlay(overlay._editorKey);

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const pageRect = pageNode.getBoundingClientRect();
      const snapThreshold = 0.3;
      const snapTargets = getOverlaySnapTargets(pageIndex, overlay._editorKey);

      const start = {
        x: event.clientX,
        y: event.clientY,
        left: parseOverlayNumber(overlay.x),
        top: parseOverlayNumber(overlay.y),
        width: parseOverlayNumber(overlay.w),
        height: parseOverlayNumber(overlay.h),
      };

      const onMove = (moveEvent) => {
        const dx = ((moveEvent.clientX - start.x) / Math.max(pageRect.width, 1)) * 100;
        const dy = ((moveEvent.clientY - start.y) / Math.max(pageRect.height, 1)) * 100;

        let x = start.left;
        let y = start.top;
        let w = start.width;
        let h = start.height;

        if (corner === "se") {
          w = start.width + dx;
          h = start.height + dy;
        }
        if (corner === "ne") {
          w = start.width + dx;
          h = start.height - dy;
          y = start.top + dy;
        }
        if (corner === "sw") {
          w = start.width - dx;
          h = start.height + dy;
          x = start.left + dx;
        }
        if (corner === "nw") {
          w = start.width - dx;
          h = start.height - dy;
          x = start.left + dx;
          y = start.top + dy;
        }

        w = clamp(w, 1, 100);
        h = clamp(h, 0.5, 100);
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);

        const right = x + w;
        const bottom = y + h;

        if (corner === "se") {
          const snappedRight = snapValue(right, snapTargets.xEdges, snapThreshold);
          const snappedBottom = snapValue(bottom, snapTargets.yEdges, snapThreshold);
          if (snappedRight !== right) w = clamp(snappedRight - x, 1, 100);
          if (snappedBottom !== bottom) h = clamp(snappedBottom - y, 0.5, 100);
        }

        if (corner === "ne") {
          const snappedRight = snapValue(right, snapTargets.xEdges, snapThreshold);
          const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
          if (snappedRight !== right) w = clamp(snappedRight - x, 1, 100);
          if (snappedTop !== y) {
            const oldBottom = y + h;
            y = snappedTop;
            h = clamp(oldBottom - y, 0.5, 100);
          }
        }

        if (corner === "sw") {
          const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
          const snappedBottom = snapValue(bottom, snapTargets.yEdges, snapThreshold);
          if (snappedLeft !== x) {
            const oldRight = x + w;
            x = snappedLeft;
            w = clamp(oldRight - x, 1, 100);
          }
          if (snappedBottom !== bottom) h = clamp(snappedBottom - y, 0.5, 100);
        }

        if (corner === "nw") {
          const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
          const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
          if (snappedLeft !== x) {
            const oldRight = x + w;
            x = snappedLeft;
            w = clamp(oldRight - x, 1, 100);
          }
          if (snappedTop !== y) {
            const oldBottom = y + h;
            y = snappedTop;
            h = clamp(oldBottom - y, 0.5, 100);
          }
        }

        w = clamp(w, 1, 100);
        h = clamp(h, 0.5, 100);
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);

        editor.updateOverlay(overlay._editorKey, {
          x,
          y,
          w,
          h,
        });
      };

      const onUp = () => {
        stopOverlayInteraction(`${overlay.id || "Dish"}: Adjusted overlay position`);
      };

      overlayInteractionRef.current = {
        overlayKey: overlay._editorKey,
        overlayName: overlay.id || "Dish",
        onMove,
        onUp,
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, getOverlaySnapTargets, mappingEnabled, stopOverlayInteraction],
  );

  useEffect(() => {
    return () => {
      stopOverlayInteraction();
    };
  }, [stopOverlayInteraction]);

  const onPagePointerDown = useCallback(
    (event, pageIndex) => {
      if (!mappingEnabled) return;
      if (event.button !== 0) return;

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const rect = pageNode.getBoundingClientRect();

      const startX = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100, 0, 100);
      const startY = clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100, 0, 100);

      mappingDragRef.current = {
        pageIndex,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
      };

      setMappedRectPreview({
        pageIndex,
        x: startX,
        y: startY,
        w: 0,
        h: 0,
      });

      const onMove = (moveEvent) => {
        const moveX = clamp(
          ((moveEvent.clientX - rect.left) / Math.max(rect.width, 1)) * 100,
          0,
          100,
        );
        const moveY = clamp(
          ((moveEvent.clientY - rect.top) / Math.max(rect.height, 1)) * 100,
          0,
          100,
        );

        const drag = mappingDragRef.current;
        if (!drag) return;

        drag.currentX = moveX;
        drag.currentY = moveY;

        const x = Math.min(drag.startX, moveX);
        const y = Math.min(drag.startY, moveY);
        const w = Math.abs(moveX - drag.startX);
        const h = Math.abs(moveY - drag.startY);

        setMappedRectPreview({ pageIndex, x, y, w, h });
      };

      const onUp = () => {
        const drag = mappingDragRef.current;
        mappingDragRef.current = null;
        setMappedRectPreview(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);

        if (!drag) return;
        const x = Math.min(drag.startX, drag.currentX);
        const y = Math.min(drag.startY, drag.currentY);
        const w = Math.abs(drag.currentX - drag.startX);
        const h = Math.abs(drag.currentY - drag.startY);

        if (w <= 1 || h <= 1) return;
        editor.mapDetectedDish({ x, y, w, h, pageIndex: drag.pageIndex });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, mappingEnabled],
  );

  if (!editor.canEdit) {
    return (
      <section className="rounded-2xl border border-[rgba(124,156,255,0.2)] bg-[rgba(11,14,34,0.82)] p-4">
        <p className="m-0 text-sm text-[#b9c6eb]">
          You do not have edit access for this restaurant.
        </p>
      </section>
    );
  }

  return (
    <section className="restaurant-legacy-editor">
      <div className="editorLayout restaurant-legacy-editor-layout">
        <div className="editorHeaderStack restaurant-legacy-editor-header">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-[2.6rem] leading-none text-[#eaf0ff]">Webpage editor</h1>
            <span className="chip active preference-chip">{overlayCountLabel}</span>
            {editor.isDirty ? (
              <span className="chip active preference-chip" style={{ borderColor: "#facc15" }}>
                Unsaved changes
              </span>
            ) : (
              <span className="chip active preference-chip" style={{ borderColor: "#22c55e" }}>
                Saved
              </span>
            )}
          </div>

          <div className="editorHeaderRow hasMiniMap">
            <div className="editorMiniMapSlot">
              <div className="restaurant-legacy-page-card">
                <button
                  type="button"
                  className="restaurant-legacy-page-thumb"
                  onClick={jumpFromMinimap}
                  title="Jump to menu area"
                >
                  {editor.draftMenuImages[editor.activePageIndex] ? (
                    <img
                      src={editor.draftMenuImages[editor.activePageIndex]}
                      alt={`Menu thumbnail page ${editor.activePageIndex + 1}`}
                    />
                  ) : (
                    <span>No page</span>
                  )}
                  <span
                    className="restaurant-legacy-page-thumb-viewport"
                    style={{
                      top: `${minimapViewport.topRatio * 100}%`,
                      height: `${minimapViewport.heightRatio * 100}%`,
                    }}
                  />
                </button>
                <div className="restaurant-legacy-page-footer">
                  Page {editor.activePageIndex + 1} of {editor.draftMenuImages.length}
                </div>
                {editor.draftMenuImages.length > 1 ? (
                  <div className="restaurant-legacy-page-controls">
                    <button
                      type="button"
                      onClick={() => scrollToPage(editor.activePageIndex - 1)}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollToPage(editor.activePageIndex + 1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="editorControlColumn">
              <div className="editorToolbarScale">
                <div className="editorToolbar">
                  <div className="editorGroup">
                    <div className="editorGroupLabel">Editing</div>
                    <div className="editorGroupButtons">
                      <button className="btn btnPrimary" onClick={editor.addOverlay}>
                        + Add overlay
                      </button>
                      <button
                        className="btn"
                        onClick={editor.undo}
                        disabled={!editor.canUndo}
                        style={{ opacity: editor.canUndo ? 1 : 0.5 }}
                      >
                        ↶ Undo
                      </button>
                      <button
                        className="btn"
                        onClick={editor.redo}
                        disabled={!editor.canRedo}
                        style={{ opacity: editor.canRedo ? 1 : 0.5 }}
                      >
                        ↷ Redo
                      </button>
                    </div>
                  </div>

                  <div className="editorGroup">
                    <div className="editorGroupLabel">Menu pages</div>
                    <div className="editorGroupButtons">
                      <button className="btn" onClick={() => editor.setMenuPagesOpen(true)}>
                        🗂 Edit menu images
                      </button>
                      <button className="btn" onClick={() => editor.setChangeLogOpen(true)}>
                        📋 View log of changes
                      </button>
                      <button className="btn" onClick={editor.runDetectDishes}>
                        🔍 Detect dishes
                      </button>
                    </div>
                  </div>

                  <div className="editorGroup">
                    <div className="editorGroupLabel">Restaurant</div>
                    <div className="editorGroupButtons">
                      <button
                        className="btn"
                        onClick={() => editor.setRestaurantSettingsOpen(true)}
                      >
                        ⚙ Restaurant settings
                      </button>
                      <button
                        className="btn btnDanger"
                        onClick={() => editor.setConfirmInfoOpen(true)}
                      >
                        Confirm information is up-to-date
                      </button>
                      <button
                        className="btn btnPrimary"
                        onClick={editor.save}
                        disabled={!editor.isDirty || editor.isSaving}
                      >
                        {editor.isSaving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="editorNoteRow">
                <div className="note" id="editorNote">
                  Drag to move. Drag any corner to resize. Click ✏️ to edit details.
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="note" style={{ fontSize: 12 }}>
                    Zoom:
                  </span>
                  <button className="btn" onClick={editor.zoomOut}>
                    −
                  </button>
                  <span id="zoomLevel" style={{ fontSize: 13, minWidth: 45, textAlign: "center", color: "#a8b2d6" }}>
                    {Math.round(editor.zoomScale * 100)}%
                  </span>
                  <button className="btn" onClick={editor.zoomIn}>
                    +
                  </button>
                  <button className="btn" onClick={editor.zoomReset}>
                    Reset
                  </button>
                </div>
              </div>

              {editor.saveError ? (
                <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                  {editor.saveError}
                </p>
              ) : null}
            </div>
          </div>

          {editor.detectWizardOpen ? (
            <div id="detectedDishesPanel" style={{ display: "block", background: "#1a2351", border: "1px solid #2a3261", borderRadius: 12, padding: 20, marginBottom: 4, textAlign: "center" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: 8 }} id="currentDishName">
                {editor.detectWizardState.loading
                  ? "Detecting dishes..."
                  : allMapped
                    ? "All items mapped!"
                    : currentWizardDish?.name || "No dishes detected"}
              </div>
              <div className="note" style={{ marginBottom: 12 }}>
                {mappingEnabled
                  ? "Press and drag on the menu to create an overlay for this item"
                  : allMapped
                    ? "All detected dishes are mapped."
                    : editor.detectWizardState.error || ""}
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", fontSize: 14, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  id="prevDishBtn"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  disabled={editor.detectWizardState.currentIndex <= 0}
                  onClick={() => editor.setDetectWizardIndex(editor.detectWizardState.currentIndex - 1)}
                >
                  ← Previous
                </button>
                <span id="dishProgress" style={{ color: "#a8b2d6" }}>
                  {editor.detectWizardState.loading
                    ? "Analyzing..."
                    : `${mappedCount} of ${detectDishes.length} mapped`}
                </span>
                <button
                  className="btn"
                  id="nextDishBtn"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  disabled={editor.detectWizardState.currentIndex >= detectDishes.length - 1}
                  onClick={() => editor.setDetectWizardIndex(editor.detectWizardState.currentIndex + 1)}
                >
                  Next →
                </button>
                <button
                  className="btn btnSuccess"
                  id="finishMappingBtn"
                  style={{ padding: "6px 12px", fontSize: 13, display: mappedCount > 0 ? "inline-flex" : "none" }}
                  onClick={editor.closeDetectWizard}
                >
                  ✓ Finish Mapping
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div
          ref={menuScrollRef}
          className="menuWrap show restaurant-legacy-editor-stage"
          style={{ cursor: mappingEnabled ? "crosshair" : "default" }}
        >
          <div
            className="menuInner"
            style={{
              zoom: editor.zoomScale,
            }}
          >
            {editor.overlaysByPage.map((page) => (
              <div
                key={`editor-page-${page.pageIndex}`}
                ref={(node) => {
                  pageRefs.current[page.pageIndex] = node;
                }}
                className="restaurant-legacy-editor-page"
                style={{ position: "relative", width: "100%" }}
                onPointerDown={(event) => onPagePointerDown(event, page.pageIndex)}
              >
                {page.image ? (
                  <img
                    src={page.image}
                    alt={`Menu page ${page.pageIndex + 1}`}
                    className="menuImg"
                    ref={(node) => {
                      pageImageRefs.current[page.pageIndex] = node;
                    }}
                  />
                ) : (
                  <div className="restaurant-legacy-no-image">No menu image available.</div>
                )}

                {page.overlays.map((overlay) => {
                  const isSelected = editor.selectedOverlayKey === overlay._editorKey;
                  return (
                    <div
                      key={overlay._editorKey}
                      className={`editBox ${isSelected ? "active" : ""}`}
                      style={{
                        left: `${parseOverlayNumber(overlay.x)}%`,
                        top: `${parseOverlayNumber(overlay.y)}%`,
                        width: `${parseOverlayNumber(overlay.w)}%`,
                        height: `${parseOverlayNumber(overlay.h)}%`,
                        pointerEvents: mappingEnabled ? "none" : "auto",
                      }}
                      title={overlay.id || "Dish"}
                      onPointerDown={(event) => startDragOverlay(event, overlay, page.pageIndex)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        editor.selectOverlay(overlay._editorKey);
                      }}
                    >
                      <button
                        type="button"
                        className="editBadge"
                        title="Edit this item"
                        onClick={(event) => {
                          event.stopPropagation();
                          editor.openDishEditor(overlay._editorKey);
                        }}
                      >
                        ✏️
                      </button>

                      {(["nw", "ne", "sw", "se"]).map((corner) => (
                        <div
                          key={`${overlay._editorKey}-${corner}`}
                          className={`handle ${corner}`}
                          onPointerDown={(event) =>
                            startResizeOverlay(event, overlay, page.pageIndex, corner)
                          }
                        />
                      ))}
                    </div>
                  );
                })}

                {mappedRectPreview && mappedRectPreview.pageIndex === page.pageIndex ? (
                  <div
                    style={{
                      position: "absolute",
                      left: `${mappedRectPreview.x}%`,
                      top: `${mappedRectPreview.y}%`,
                      width: `${mappedRectPreview.w}%`,
                      height: `${mappedRectPreview.h}%`,
                      border: "2px dashed #4caf50",
                      background: "rgba(76,175,80,0.2)",
                      pointerEvents: "none",
                      zIndex: 1000,
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="restaurant-legacy-help-fab">
        <Link href="/help-contact">Help</Link>
      </footer>

      <DishEditorModal editor={editor} />
      <ChangeLogModal editor={editor} />
      <ConfirmInfoModal editor={editor} />
      <MenuPagesModal editor={editor} />
      <RestaurantSettingsModal editor={editor} />
    </section>
  );
}

export default RestaurantEditor;
