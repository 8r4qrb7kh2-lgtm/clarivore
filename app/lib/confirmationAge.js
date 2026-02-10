const DAY_MS = 24 * 60 * 60 * 1000;

export function getWeeksAgoInfo(
  date,
  { showAll = true, useMonthLabel = false } = {},
) {
  if (!date) return { text: "Never", color: "#888", shouldHide: false };

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return { text: "Never", color: "#888", shouldHide: false };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const compareDate = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );

  const diffDays = Math.floor((today - compareDate) / DAY_MS);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffDays > 30 && !showAll) {
    return { text: null, color: null, shouldHide: true };
  }

  if (diffDays < 7) return { text: "this week", color: "#4caf50", shouldHide: false };
  if (diffWeeks === 1) return { text: "last week", color: "#8bc34a", shouldHide: false };
  if (diffWeeks === 2) return { text: "two weeks ago", color: "#ff9800", shouldHide: false };
  if (diffWeeks === 3) return { text: "three weeks ago", color: "#f44336", shouldHide: false };
  if (diffDays <= 30 && useMonthLabel) {
    return { text: "one month ago", color: "#f44336", shouldHide: false };
  }
  if (showAll) return { text: `${diffWeeks} weeks ago`, color: "#f44336", shouldHide: false };
  return { text: "one month ago", color: "#f44336", shouldHide: false };
}
