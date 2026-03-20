import ChatPreviewPanel from "../../../../components/chat/ChatPreviewPanel";
import SurfaceCard from "../../../../components/surfaces/SurfaceCard";
import { ADMIN_DISPLAY_NAME } from "../constants/dashboardConstants";
import { resolveManagerChatLink } from "../utils/displayUtils";

// Top card focused on direct messages.
export function QuickActionsSection({
  chatUnreadCount,
  chatMessages,
  managerChatAckByIndex,
  chatInput,
  setChatInput,
  onSendChatMessage,
  onAcknowledgeChat,
  chatSending,
  managerDisplayName,
  chatListRef,
  chatHasOlderMessages,
  chatLoadingOlderMessages,
  onLoadOlderMessages,
  overlayPublicationSummary,
  webpageEditorHref,
}) {
  const publishedCount = Number(overlayPublicationSummary?.publishedOverlayCount) || 0;
  const totalCount = Number(overlayPublicationSummary?.totalOverlayCount) || 0;
  const unpublishedCount = Number(overlayPublicationSummary?.unpublishedOverlayCount) || 0;

  return (
    <SurfaceCard className="section quick-actions-section">
      <div className="quick-actions-grid">
        <ChatPreviewPanel
          title="Direct Messages"
          unreadCount={chatUnreadCount}
          messages={chatMessages}
          ackByIndex={managerChatAckByIndex}
          inputValue={chatInput}
          onInputChange={setChatInput}
          onInputKeyDown={(event) => {
            // Enter sends, Shift+Enter inserts newline.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSendChatMessage();
            }
          }}
          onSend={onSendChatMessage}
          onAcknowledge={onAcknowledgeChat}
          sending={chatSending}
          emptyText="No messages yet"
          resolveLink={resolveManagerChatLink}
          listRef={chatListRef}
          cardClassName="quick-actions-panel"
          listClassName="chat-preview-list"
          hasMoreMessages={chatHasOlderMessages}
          loadingMoreMessages={chatLoadingOlderMessages}
          onLoadMoreMessages={onLoadOlderMessages}
          senderLabelResolver={(message) => {
            const senderName = String(message.sender_name || "").trim();
            const isOutgoing = message.sender_role === "restaurant";
            return isOutgoing
              ? senderName && senderName.toLowerCase() !== "you"
                ? senderName
                : managerDisplayName
              : senderName || ADMIN_DISPLAY_NAME;
          }}
          isOutgoingResolver={(message) => message.sender_role === "restaurant"}
        />

        <div className="quick-actions-panel publication-summary-panel">
          <p className="quick-actions-title">Published overlays</p>
          {totalCount > 0 ? (
            <>
              <p className="publication-summary-value">
                {publishedCount}/{totalCount}
              </p>
              <p className="publication-summary-label">currently published</p>
              <p className="publication-summary-helper">
                {unpublishedCount > 0
                  ? `${unpublishedCount} dish overlay${unpublishedCount === 1 ? " is" : "s are"} hidden from viewing mode until the ingredient rows are confirmed again in the webpage editor.`
                  : "All dish overlays are currently visible in viewing mode."}
              </p>
            </>
          ) : (
            <p className="publication-summary-helper">
              No dish overlays have been saved for this restaurant yet.
            </p>
          )}

          {webpageEditorHref ? (
            <a className="btn btnPrimary publication-summary-link" href={webpageEditorHref}>
              Open webpage editor
            </a>
          ) : null}
        </div>
      </div>
    </SurfaceCard>
  );
}
