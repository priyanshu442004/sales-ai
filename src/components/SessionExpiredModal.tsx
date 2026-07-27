import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Modal, Button } from './ui/core';
import { useUiStore } from '../store/useUiStore';
import { SESSION_EXPIRED_EVENT } from '../services/sourcingApi';

// Mounted once in AppShell — listens for the global "session expired" event
// any API call can fire (see sourcingApi.ts's request() 401 handler) and
// shows an explanatory modal instead of leaving the user on a page that's
// silently failing every request, or redirecting them without warning.
export const SessionExpiredModal: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const setCurrentUser = useUiStore((s) => s.setCurrentUser);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, []);

  const handleLoginAgain = () => {
    setOpen(false);
    // Clearing currentUser only now (not the instant the event fires) is
    // deliberate — it's what actually triggers ProtectedRoute's redirect,
    // and doing that at the same moment as the explicit navigate() avoids
    // a race where the route swaps out from under the still-open modal.
    setCurrentUser(null);
    navigate('/login', { replace: true });
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => {}} // no dismiss without acting — an expired session isn't resolved by closing the dialog
      title="Session Expired"
      size="sm"
      footer={
        <div className="ml-auto">
          <Button variant="primary" size="sm" icon={LogIn} onClick={handleLoginAgain}>
            Log In Again
          </Button>
        </div>
      }
    >
      <p className="text-sm text-text-secondary leading-relaxed">
        Your session has expired or is no longer valid. Please log in again to continue.
      </p>
    </Modal>
  );
};
