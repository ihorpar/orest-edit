"use client";

import { useEffect } from "react";
import { Button } from "../ui/Button";

export function DraftResetDialog({
  open,
  onConfirm,
  onCancel
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="draft-reset-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section className="draft-reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="draft-reset-dialog-title">
        <div className="draft-reset-dialog-head">
          <p className="mono-ui draft-reset-dialog-kicker">Очистити текст</p>
          <button type="button" className="draft-reset-dialog-close" onClick={onCancel} aria-label="Закрити підтвердження">
            <svg viewBox="0 0 12 12" aria-hidden="true" className="draft-reset-dialog-close-icon">
              <path d="M2 2L10 10" />
              <path d="M10 2L2 10" />
            </svg>
          </button>
        </div>

        <p id="draft-reset-dialog-title" className="draft-reset-dialog-title">
          Очистити весь текст?
        </p>

        <div className="draft-reset-dialog-actions">
          <Button variant="secondary" size="sm" onClick={onCancel} autoFocus>
            Скасувати
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            Очистити
          </Button>
        </div>
      </section>
    </div>
  );
}
