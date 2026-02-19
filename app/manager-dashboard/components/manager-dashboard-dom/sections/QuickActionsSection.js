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
}) {
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
      </div>
    </SurfaceCard>
  );
}
