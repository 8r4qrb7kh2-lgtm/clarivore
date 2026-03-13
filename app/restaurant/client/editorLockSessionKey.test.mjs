import assert from "node:assert/strict";
import test from "node:test";

import {
  readOrCreateEditorLockSessionKey,
} from "./editorLockSessionKey.js";

function createStorage(initialValues = {}) {
  const state = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return state.has(key) ? state.get(key) : null;
    },
    setItem(key, value) {
      state.set(key, String(value));
    },
  };
}

test("readOrCreateEditorLockSessionKey reuses the existing in-memory key", () => {
  const storage = createStorage();
  const sessionKey = readOrCreateEditorLockSessionKey({
    currentKey: "existing-key",
    storage,
    generateKey: () => "generated-key",
  });

  assert.equal(sessionKey, "existing-key");
  assert.equal(storage.getItem("clarivoreEditorLockSessionKey"), "existing-key");
});

test("readOrCreateEditorLockSessionKey reuses a stored tab key before generating a new one", () => {
  const storage = createStorage({
    clarivoreEditorLockSessionKey: "stored-tab-key",
  });

  const sessionKey = readOrCreateEditorLockSessionKey({
    storage,
    generateKey: () => "generated-key",
  });

  assert.equal(sessionKey, "stored-tab-key");
});

test("readOrCreateEditorLockSessionKey creates and stores a new key when missing", () => {
  const storage = createStorage();

  const sessionKey = readOrCreateEditorLockSessionKey({
    storage,
    generateKey: () => "generated-key",
  });

  assert.equal(sessionKey, "generated-key");
  assert.equal(storage.getItem("clarivoreEditorLockSessionKey"), "generated-key");
});
