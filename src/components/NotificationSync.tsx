import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getNotifications } from '../services/sourcingApi';
import { useUiStore } from '../store/useUiStore';
import type { AppNotification } from '../store/useUiStore';

const POLL_INTERVAL_MS = 6000;
const NOTIF_PROMPT_DISMISSED_KEY = 'sales_ai_notif_prompt_dismissed';

const TOAST_FN: Record<AppNotification['type'], typeof toast.success> = {
  job_completed: toast.success,
  job_partial: toast.warning,
  job_failed: toast.error,
  email_sent: toast.success,
  email_partial: toast.warning,
  email_failed: toast.error,
  team_invited: toast.success,
  team_member_first_login: toast.message,
};

/**
 * App-wide sync (mounted once in AppShell, so it works no matter which page
 * is open) that polls the *real, persisted* notification feed — job
 * completions, email sends/failures — and surfaces a bottom-right toast
 * (plus a native desktop notification when permission is granted) the
 * moment a new one appears, exactly like the TradingView-style alert this
 * app already commits to. Read/unread state and history live entirely in
 * the database via notifications.py; this component only mirrors it into
 * the UI store and detects what's new-since-last-poll for the toast.
 */
export const NotificationSync: React.FC = () => {
  const setNotifications = useUiStore((s) => s.setNotifications);
  const seenIds = useRef<Set<string>>(new Set());
  const seenFirstPoll = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getNotifications();
        const raw: any[] = res?.data || [];
        const mapped: AppNotification[] = raw.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          desc: n.description || '',
          time: n.createdAt,
          unread: !n.read,
          jobId: n.relatedJobId || undefined,
        }));

        if (!cancelled) setNotifications(mapped);

        if (seenFirstPoll.current) {
          // Don't fire a wave of toasts for notifications that already
          // existed before this tab loaded — only genuinely new ones.
          for (const n of mapped) {
            if (seenIds.current.has(n.id)) continue;
            seenIds.current.add(n.id);

            const toastFn = TOAST_FN[n.type] || toast.message;
            if (!cancelled) {
              toastFn(n.title, { description: n.desc, position: 'bottom-right', duration: 8000 });
            }

            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification(n.title, { body: n.desc, icon: '/favicon.svg' });
              } catch {
                // Some browsers/embeds disallow constructing Notification directly — ignore.
              }
            }
          }
        } else {
          mapped.forEach((n) => seenIds.current.add(n.id));
        }

        seenFirstPoll.current = true;
      } catch {
        // Silent — this is a passive background sync; page-level fetches
        // already surface real connectivity errors to the user.
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setNotifications]);

  // Soft, TradingView-style ask for desktop notification permission — a
  // dismissible toast with an explicit "Enable" action, never an
  // unsolicited native browser prompt on page load.
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIF_PROMPT_DISMISSED_KEY)) return;

    const dismiss = () => localStorage.setItem(NOTIF_PROMPT_DISMISSED_KEY, '1');

    const id = toast('Get notified when a search finishes or an email is sent', {
      description: 'Turn on desktop notifications so you know the moment something happens, even in another tab.',
      position: 'bottom-right',
      duration: 15000,
      action: {
        label: 'Enable',
        onClick: () => {
          Notification.requestPermission();
          dismiss();
        },
      },
      onDismiss: dismiss,
      onAutoClose: dismiss,
    });

    return () => {
      toast.dismiss(id);
    };
  }, []);

  return null;
};
