"use client";

import { useMemo } from "react";
import SurfaceCard from "../surfaces/SurfaceCard";
import ChatMessageText from "./ChatMessageText";
import { Button } from "../ui";
import { formatChatTimestamp } from "../../lib/chatMessage";
import styles from "./ChatPreviewPanel.module.css";

function getAckEntries(ackByIndex, index) {
  if (!ackByIndex) return [];
  if (ackByIndex instanceof Map) return ackByIndex.get(index) || [];
  if (typeof ackByIndex === "object") return ackByIndex[index] || [];
  return [];
}

export default function ChatPreviewPanel({
  title,
  unreadCount = 0,
  messages = [],
  ackByIndex,
  inputValue,
  onInputChange,
  onInputKeyDown,
  onSend,
  onAcknowledge,
  sending = false,
  emptyText = "No messages yet.",
  resolveLink,
  senderLabelResolver,
  isOutgoingResolver,
  listRef,
  cardClassName,
  listClassName,
  inputPlaceholder = "Message Clarivore",
  sendLabel = "Send",
  acknowledgeLabel = "Acknowledge message(s)",
}) {
  const safeMessages = useMemo(
    () => (Array.isArray(messages) ? messages : []),
    [messages],
  );

  const headerRight = (
    <div className={styles.actions}>
      {unreadCount > 0 ? (
        <Button className="btn btnWarning" type="button" onClick={onAcknowledge}>
          {acknowledgeLabel}
        </Button>
      ) : null}
    </div>
  );

  return (
    <SurfaceCard
      className={cardClassName}
      title={
        <span className={styles.heading}>
          <span className={styles.title}>{title}</span>
          {unreadCount > 0 ? <span className={styles.badge}>{unreadCount}</span> : null}
        </span>
      }
      headerRight={headerRight}
    >
      <div className={`${styles.list}${listClassName ? ` ${listClassName}` : ""}`} ref={listRef}>
        {safeMessages.length === 0 ? (
          <div className={styles.empty}>{emptyText}</div>
        ) : (
          safeMessages.map((message, index) => {
            const isOutgoing =
              typeof isOutgoingResolver === "function"
                ? Boolean(isOutgoingResolver(message, index))
                : message?.sender_role === "restaurant";

            const senderLabel =
              typeof senderLabelResolver === "function"
                ? senderLabelResolver(message, index)
                : String(message?.sender_name || "").trim();

            const timestamp = formatChatTimestamp(message?.created_at);
            const acknowledgements = getAckEntries(ackByIndex, index);

            return (
              <div key={message?.id || `${message?.created_at || ""}-${index}`}>
                <div className={`${styles.message} ${isOutgoing ? styles.outgoing : styles.incoming}`}>
                  <div>
                    <ChatMessageText text={message?.message || ""} resolveLink={resolveLink} />
                  </div>
                  <div className={styles.meta}>
                    {senderLabel}
                    {timestamp ? ` · ${timestamp}` : ""}
                  </div>
                </div>
                {(Array.isArray(acknowledgements) ? acknowledgements : []).map((entry, ackIndex) => {
                  const ackAt = entry?.acknowledgedAt || entry?.at || "";
                  const ackTimestamp = formatChatTimestamp(ackAt);
                  if (!ackTimestamp) return null;
                  return (
                    <div className={styles.ack} key={`${index}-${ackIndex}-${entry?.name || "ack"}`}>
                      {entry?.name || "Acknowledged"} acknowledged · {ackTimestamp}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <div className={styles.compose}>
        <input
          className={styles.input}
          type="text"
          value={inputValue}
          placeholder={inputPlaceholder}
          onChange={(event) => onInputChange?.(event.target.value)}
          onKeyDown={onInputKeyDown}
          disabled={sending}
        />
        <Button className="btn" type="button" onClick={onSend} disabled={sending}>
          {sending ? "Sending..." : sendLabel}
        </Button>
      </div>
    </SurfaceCard>
  );
}
