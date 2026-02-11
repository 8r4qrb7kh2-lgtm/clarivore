"use client";

import { useMemo } from "react";
import { Badge, Button, Input, Textarea } from "../../../components/ui";

function asCsv(list) {
  if (!Array.isArray(list) || !list.length) return "";
  return list.join(", ");
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

export function RestaurantEditor({ editor }) {
  const selected = editor.selectedOverlay;

  const overlayCountLabel = useMemo(() => {
    const count = editor.draftOverlays.length;
    return `${count} overlay${count === 1 ? "" : "s"}`;
  }, [editor.draftOverlays.length]);

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
    <section className="space-y-3 rounded-2xl border border-[rgba(124,156,255,0.25)] bg-[rgba(11,14,34,0.82)] p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-lg font-semibold text-[#eef3ff]">Menu editor</h2>
          <Badge tone="neutral">{overlayCountLabel}</Badge>
          {editor.isDirty ? <Badge tone="warn">Unsaved changes</Badge> : <Badge tone="success">Saved</Badge>}
        </div>
        <div className="flex gap-2">
          <Button size="compact" variant="outline" onClick={editor.addOverlay}>
            Add overlay
          </Button>
          <Button size="compact" tone="primary" loading={editor.isSaving} onClick={editor.save}>
            Save changes
          </Button>
        </div>
      </header>

      {editor.saveError ? (
        <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
          {editor.saveError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="max-h-[62vh] space-y-2 overflow-auto rounded-xl border border-[rgba(124,156,255,0.2)] bg-[rgba(17,22,48,0.65)] p-2">
          {editor.draftOverlays.map((overlay, index) => {
            const selectedOverlay = selected?.id === overlay.id;
            return (
              <button
                key={`${overlay.id}-${index}`}
                type="button"
                onClick={() => editor.setSelectedOverlayId(overlay.id)}
                className="w-full rounded-lg border p-2 text-left"
                style={{
                  borderColor: selectedOverlay
                    ? "rgba(124,156,255,0.7)"
                    : "rgba(124,156,255,0.2)",
                  background: selectedOverlay
                    ? "rgba(76,90,212,0.2)"
                    : "rgba(6,10,28,0.5)",
                }}
              >
                <p className="m-0 text-sm font-medium text-[#eef3ff]">{overlay.name}</p>
                <p className="m-0 mt-1 text-xs text-[#a7b2d1]">
                  {overlay.description || "No description"}
                </p>
              </button>
            );
          })}
          {!editor.draftOverlays.length ? (
            <p className="m-0 rounded-lg border border-[rgba(124,156,255,0.2)] bg-[rgba(6,10,28,0.4)] p-2 text-xs text-[#a7b2d1]">
              No overlays yet. Add one to start editing.
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-[rgba(124,156,255,0.2)] bg-[rgba(17,22,48,0.75)] p-3">
          {selected ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  Dish name
                  <Input
                    value={selected.name || ""}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, { name: event.target.value })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  Description
                  <Input
                    value={selected.description || ""}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, { description: event.target.value })
                    }
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  X (%)
                  <Input
                    type="number"
                    value={selected.x}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, {
                        x: parseNumber(event.target.value, selected.x),
                      })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  Y (%)
                  <Input
                    type="number"
                    value={selected.y}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, {
                        y: parseNumber(event.target.value, selected.y),
                      })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  Width (%)
                  <Input
                    type="number"
                    value={selected.w}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, {
                        w: parseNumber(event.target.value, selected.w),
                      })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  Height (%)
                  <Input
                    type="number"
                    value={selected.h}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, {
                        h: parseNumber(event.target.value, selected.h),
                      })
                    }
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  Allergens (comma separated)
                  <Input
                    value={asCsv(selected.allergens)}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, {
                        allergens: parseCsv(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm text-[#bdd0ff]">
                  Diets (comma separated)
                  <Input
                    value={asCsv(selected.diets)}
                    onChange={(event) =>
                      editor.updateOverlay(selected.id, {
                        diets: parseCsv(event.target.value),
                      })
                    }
                  />
                </label>
              </div>

              <label className="space-y-1 text-sm text-[#bdd0ff]">
                Notes
                <Textarea
                  rows={4}
                  value={selected.details?.description || ""}
                  onChange={(event) =>
                    editor.updateOverlay(selected.id, {
                      details: {
                        ...(selected.details || {}),
                        description: event.target.value,
                      },
                    })
                  }
                />
              </label>

              <div className="flex justify-end">
                <Button
                  size="compact"
                  tone="danger"
                  variant="outline"
                  onClick={() => editor.removeOverlay(selected.id)}
                >
                  Delete overlay
                </Button>
              </div>
            </div>
          ) : (
            <p className="m-0 text-sm text-[#a7b2d1]">
              Select an overlay to edit.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export default RestaurantEditor;
