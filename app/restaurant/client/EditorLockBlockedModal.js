import { Button, Modal } from "../../components/ui";

const DEFAULT_MESSAGE = "Someone is currently in web page editor.";

export default function EditorLockBlockedModal({
  open,
  message,
  refreshBusy = false,
  onRefresh,
  onReturnDashboard,
}) {
  return (
    <Modal
      open={Boolean(open)}
      onOpenChange={() => {}}
      title="Editor unavailable"
      className="max-w-[520px]"
      closeOnEsc={false}
      closeOnOverlay={false}
    >
      <div className="space-y-4">
        <p className="m-0 text-sm text-[#d8e3ff]">{message || DEFAULT_MESSAGE}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="compact"
            variant="outline"
            tone="neutral"
            disabled={refreshBusy}
            onClick={onReturnDashboard}
          >
            Return to dashboard
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={refreshBusy}
            onClick={onRefresh}
          >
            Refresh status
          </Button>
        </div>
      </div>
    </Modal>
  );
}
