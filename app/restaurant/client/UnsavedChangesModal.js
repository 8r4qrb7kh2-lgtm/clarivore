import { Button, Modal } from "../../components/ui";

export default function UnsavedChangesModal({ modalState }) {
  if (!modalState) return null;

  // This dialog is intentionally simple: save, discard, or cancel.
  return (
    <Modal
      open={modalState.open}
      onOpenChange={modalState.onOpenChange}
      title="You have unsaved changes"
      className="max-w-[560px]"
      closeOnEsc={!modalState.saving}
      closeOnOverlay={!modalState.saving}
    >
      <div className="space-y-3">
        <p className="m-0 text-sm text-[#cfd8f6]">{modalState.copy}</p>

        {/* Show save failure details inline so the manager can retry quickly. */}
        {modalState.error ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {modalState.error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            size="compact"
            tone="primary"
            loading={modalState.saving}
            onClick={modalState.onSaveThenLeave}
          >
            Save then leave
          </Button>
          <Button
            size="compact"
            tone="danger"
            variant="outline"
            disabled={modalState.saving}
            onClick={modalState.onLeaveWithoutSaving}
          >
            Leave without saving
          </Button>
          <Button
            size="compact"
            variant="outline"
            disabled={modalState.saving}
            onClick={modalState.onStayHere}
          >
            Stay here
          </Button>
        </div>
      </div>
    </Modal>
  );
}
