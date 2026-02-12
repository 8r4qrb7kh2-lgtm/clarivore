"use client";

/** @typedef {"current" | "legacy"} EditorParityMode */

export const EDITOR_PARITY_QUERY_KEY = "editorParity";
export const EDITOR_PARITY_STORAGE_KEY = "clarivoreEditorParityMode";

/** @type {EditorParityMode} */
export const DEFAULT_EDITOR_PARITY_MODE = "legacy";

/**
 * @param {unknown} value
 * @returns {EditorParityMode | ""}
 */
export function normalizeEditorParityMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "legacy") return "legacy";
  if (raw === "current") return "current";
  return "";
}

/**
 * @param {{
 *  queryMode?: unknown,
 *  storageMode?: unknown,
 *  envMode?: unknown,
 * }} input
 * @returns {EditorParityMode}
 */
export function resolveEditorParityMode(input = {}) {
  const fromQuery = normalizeEditorParityMode(input.queryMode);
  if (fromQuery) return fromQuery;

  const fromStorage = normalizeEditorParityMode(input.storageMode);
  if (fromStorage) return fromStorage;

  const fromEnv = normalizeEditorParityMode(input.envMode);
  if (fromEnv) return fromEnv;

  return DEFAULT_EDITOR_PARITY_MODE;
}
