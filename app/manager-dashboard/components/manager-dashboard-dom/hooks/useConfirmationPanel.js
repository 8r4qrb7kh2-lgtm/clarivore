import { useCallback, useMemo } from "react";

// Builds the menu-confirmation panel content and actions.
// This keeps due-date status rules separate from presentational JSX.
export function useConfirmationPanel({ currentRestaurantData }) {
  const confirmationInfo = useMemo(() => {
    if (!currentRestaurantData) {
      return {
        dueDateClass: "overdue",
        dueText: "Never confirmed",
        lastConfirmedText: "Never confirmed",
      };
    }

    const lastConfirmed = currentRestaurantData.last_confirmed
      ? new Date(currentRestaurantData.last_confirmed)
      : null;

    if (!lastConfirmed || Number.isNaN(lastConfirmed.getTime())) {
      return {
        dueDateClass: "overdue",
        dueText: "Never confirmed",
        lastConfirmedText: "Never confirmed",
      };
    }

    const now = new Date();
    const nextDue = new Date(lastConfirmed);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const daysUntilDue = Math.ceil((nextDue - now) / (24 * 60 * 60 * 1000));

    let dueDateClass = "ok";
    let dueText = `Due in ${daysUntilDue} days`;

    if (daysUntilDue < 0) {
      dueDateClass = "overdue";
      dueText = `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) > 1 ? "s" : ""} overdue`;
    } else if (daysUntilDue <= 7) {
      dueDateClass = "soon";
      dueText =
        daysUntilDue === 0
          ? "Due today"
          : `Due in ${daysUntilDue} day${daysUntilDue > 1 ? "s" : ""}`;
    }

    return {
      dueDateClass,
      dueText,
      lastConfirmedText: `Last confirmed: ${lastConfirmed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`,
    };
  }, [currentRestaurantData]);

  const onConfirmNow = useCallback(() => {
    // Redirect to restaurant editor with query flags that open confirmation flow immediately.
    const slug = currentRestaurantData?.slug;
    if (!slug) return;

    const params = new URLSearchParams({
      slug,
      edit: "1",
      openConfirm: "1",
    });

    window.location.href = `/restaurant?${params.toString()}`;
  }, [currentRestaurantData]);

  return {
    confirmationInfo,
    onConfirmNow,
  };
}
