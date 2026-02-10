export function fmtDate(value) {
  try {
    const date = new Date(value);
    return isNaN(date) ? "" : date.toLocaleDateString();
  } catch (_) {
    return "";
  }
}

export function fmtDateTime(value) {
  try {
    const date = new Date(value);
    return isNaN(date)
      ? ""
      : date.toLocaleDateString() + " at " + date.toLocaleTimeString();
  } catch (_) {
    return "";
  }
}

export function getWeeksAgoInfo(date, showAll = false) {
  try {
    const parsed = new Date(date);
    if (isNaN(parsed)) return { text: "—", color: "#888" };
    const now = new Date();

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const compareDate = new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
    );

    const diffDays = Math.floor((today - compareDate) / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffDays > 30 && !showAll) {
      return null;
    }

    let text;
    let color;
    if (diffDays < 7) {
      text = "this week";
      color = "#4caf50";
    } else if (diffWeeks === 1) {
      text = "last week";
      color = "#8bc34a";
    } else if (diffWeeks === 2) {
      text = "two weeks ago";
      color = "#ff9800";
    } else if (diffWeeks === 3) {
      text = "three weeks ago";
      color = "#f44336";
    } else if (showAll) {
      text = `${diffWeeks} weeks ago`;
      color = "#f44336";
    } else {
      text = "one month ago";
      color = "#f44336";
    }

    return { text, color };
  } catch (_) {
    return { text: "—", color: "#888" };
  }
}

export function daysAgo(value) {
  const info = getWeeksAgoInfo(value);
  if (!info) return "—";
  return info.text;
}
