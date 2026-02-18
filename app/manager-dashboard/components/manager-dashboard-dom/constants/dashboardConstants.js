// This module holds fixed values that the manager dashboard reuses in many places.
// Keeping these values centralized makes behavior consistent and avoids duplicated literals.

// Name shown for the administrative side of chat acknowledgement markers.
export const ADMIN_DISPLAY_NAME = "Matt D (clarivore administrator)";

// Name used when the system, not a person, sends reminder messages.
export const AUTO_ALERT_SENDER = "Automated alert system";

// Number of days before due date when reminder messages are eligible to send.
export const CONFIRM_REMINDER_DAYS = new Set([7, 3, 2, 1]);

// UI text and button styling configuration for each accommodation request action.
export const REQUEST_ACTION_CONFIG = {
  implemented: {
    title: "Mark as Implemented",
    buttonLabel: "Mark Implemented",
    buttonClass: "success",
  },
  reviewed: {
    title: "Mark as Reviewed",
    buttonLabel: "Mark Reviewed",
    buttonClass: "primary",
  },
  declined: {
    title: "Decline Request",
    buttonLabel: "Decline Request",
    buttonClass: "decline",
  },
};

// Ordered palette used by pie charts so the same category index maps to the same color.
export const PIE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#6b7280",
];

// Fallback image for brand rows when no product image exists.
export const BRAND_IMAGE_FALLBACK =
  "https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png";
