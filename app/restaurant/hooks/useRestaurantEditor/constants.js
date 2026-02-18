// Central constants for the restaurant editor hook family.
// Keeping constants in one place avoids accidental drift between modules.

// Maximum number of snapshots we keep for undo/redo.
// Older snapshots are dropped once this limit is exceeded.
export const HISTORY_LIMIT = 50;

// Prefix used when a pending-change entry includes a stable key.
// The key lets us replace older entries instead of appending duplicates.
export const PENDING_CHANGE_KEY_PREFIX = "__pc__:";
