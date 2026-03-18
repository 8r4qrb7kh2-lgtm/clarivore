import assert from "node:assert/strict";
import test from "node:test";

import {
  canTakeOverEditorLock,
  resolveEditorLockMessage,
} from "./editorLockState.js";

test("canTakeOverEditorLock returns true only for same-user blocked sessions", () => {
  assert.equal(
    canTakeOverEditorLock({
      status: "blocked",
      reason: "same_user_other_instance",
    }),
    true,
  );
  assert.equal(
    canTakeOverEditorLock({
      status: "blocked",
      reason: "another_editor_active",
    }),
    false,
  );
  assert.equal(
    canTakeOverEditorLock({
      status: "error",
      reason: "same_user_other_instance",
    }),
    false,
  );
});

test("resolveEditorLockMessage surfaces actual errors instead of masking them", () => {
  assert.equal(
    resolveEditorLockMessage({
      status: "error",
      message: "Missing authorization token",
    }),
    "Missing authorization token",
  );
});

test("resolveEditorLockMessage distinguishes same-user lock conflicts", () => {
  assert.equal(
    resolveEditorLockMessage({
      status: "blocked",
      reason: "same_user_other_instance",
    }),
    "Another editor session from your account is holding web page editor.",
  );
});
