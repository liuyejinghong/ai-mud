import type { ReactNode } from "react";

interface ModalManagerProps<TModal> {
  activeModal: TModal | null;
  onClose: () => void;
  children: (modal: TModal, close: () => void) => ReactNode;
}

export function ModalManager<TModal>({
  activeModal,
  onClose,
  children
}: ModalManagerProps<TModal>) {
  if (!activeModal) return null;

  return (
    <div
      className="modal-backdrop"
      data-testid="modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div onMouseDown={(event) => event.stopPropagation()}>
        {children(activeModal, onClose)}
      </div>
    </div>
  );
}
