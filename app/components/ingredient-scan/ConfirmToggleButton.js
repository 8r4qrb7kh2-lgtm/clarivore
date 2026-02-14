"use client";

function toLabel(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

const SIZE_STYLES = {
  standard: {
    padding: "7px 14px",
    fontSize: "0.84rem",
    minWidth: 100,
  },
  compact: {
    padding: "5px 10px",
    fontSize: "0.8rem",
    minWidth: 88,
  },
};

export default function ConfirmToggleButton({
  confirmed = false,
  pendingLabel = "Confirm",
  confirmedLabel = "Confirmed",
  disabled = false,
  onClick,
  size = "standard",
  className = "btn",
  style,
}) {
  const sizing = SIZE_STYLES[size] || SIZE_STYLES.standard;
  return (
    <button
      type="button"
      className={className}
      style={{
        background: confirmed ? "#17663a" : "#f59e0b",
        border: confirmed ? "2px solid #22c55e" : "2px solid #d97706",
        ...sizing,
        ...(style && typeof style === "object" ? style : {}),
      }}
      disabled={Boolean(disabled)}
      onClick={onClick}
    >
      {confirmed ? toLabel(confirmedLabel, "Confirmed") : toLabel(pendingLabel, "Confirm")}
    </button>
  );
}
