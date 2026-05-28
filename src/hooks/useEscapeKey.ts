import { useEffect } from "react";

/**
 * Wywołuje `onClose` po naciśnięciu Escape gdy modal jest otwarty.
 * Używany w custom modalach (NewProjectModal, ConfirmModal, MaterialModal itp.)
 * które nie korzystają ze wspólnego `<Modal>` z ui/Modal.tsx — tam Escape jest
 * wbudowane. Bez tego hooka klawisz Escape nie zamykałby modali ad-hoc.
 */
export function useEscapeKey(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
}
