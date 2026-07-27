import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, Button } from './ui/core';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Reusable in-app replacement for window.confirm() — this product never
// shows native browser dialogs for its own functionality (delete/cancel
// confirmations, etc.), only proper in-app modals.
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={destructive ? 'destructive' : 'primary'} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        {destructive && <AlertTriangle className="w-5 h-5 text-status-danger shrink-0 mt-0.5" />}
        <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
      </div>
    </Modal>
  );
};
