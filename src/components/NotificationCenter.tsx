import React, { useState } from 'react';
import { cn } from '../utils/cn';
import { X, Bell, CheckCircle2, AlertTriangle, AlertOctagon, Mail, Trash2, Circle, UserPlus, LogIn } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import type { AppNotification } from '../store/useUiStore';
import { setNotificationRead, deleteNotification, markAllNotificationsRead } from '../services/sourcingApi';
import { toast } from 'sonner';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const NOTIF_ICONS: Record<AppNotification['type'], { icon: typeof CheckCircle2; iconColor: string }> = {
  job_completed: { icon: CheckCircle2, iconColor: 'text-status-success bg-status-success-bg' },
  job_partial: { icon: AlertTriangle, iconColor: 'text-status-warning bg-status-warning-bg' },
  job_failed: { icon: AlertOctagon, iconColor: 'text-status-danger bg-status-danger-bg' },
  email_sent: { icon: Mail, iconColor: 'text-status-success bg-status-success-bg' },
  email_partial: { icon: Mail, iconColor: 'text-status-warning bg-status-warning-bg' },
  email_failed: { icon: Mail, iconColor: 'text-status-danger bg-status-danger-bg' },
  team_invited: { icon: UserPlus, iconColor: 'text-brand-primary bg-brand-primary/10' },
  team_member_first_login: { icon: LogIn, iconColor: 'text-status-success bg-status-success-bg' },
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ isOpen, onClose }) => {
  const { notifications, setNotifications } = useUiStore();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleMarkAllRead = () =>
    withBusy('__all__', async () => {
      await markAllNotificationsRead();
      setNotifications(notifications.map((n) => ({ ...n, unread: false })));
    });

  const handleToggleRead = (n: AppNotification) =>
    withBusy(n.id, async () => {
      await setNotificationRead(n.id, n.unread);
      setNotifications(notifications.map((x) => (x.id === n.id ? { ...x, unread: !x.unread } : x)));
    });

  const handleDelete = (n: AppNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    withBusy(n.id, async () => {
      await deleteNotification(n.id);
      setNotifications(notifications.filter((x) => x.id !== n.id));
    });
  };

  const hasUnread = notifications.some((n) => n.unread);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 pl-10 max-w-full flex">
        <div className="w-screen max-w-md bg-bg-surface border-l border-border-default shadow-lg flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Bell className="w-5 h-5 text-text-primary" />
              <h2 className="text-sm font-heading font-semibold text-text-primary">Notifications</h2>
            </div>
            <div className="flex items-center space-x-2">
              {hasUnread && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-brand-primary hover:text-brand-primary-hover font-heading font-medium"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-canvas transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
            {notifications.length === 0 && (
              <div className="text-center py-16 px-6">
                <Bell className="w-8 h-8 mx-auto mb-3 text-text-tertiary opacity-40" />
                <p className="text-sm font-heading font-semibold text-text-secondary">No notifications yet</p>
                <p className="text-xs text-text-tertiary mt-1">You'll be notified here when a search finishes or an email is sent.</p>
              </div>
            )}
            {notifications.map((n) => {
              const iconInfo = NOTIF_ICONS[n.type] || NOTIF_ICONS.job_completed;
              const { icon: Icon, iconColor } = iconInfo;
              const busy = busyIds.has(n.id);
              return (
                <div
                  key={n.id}
                  onClick={() => handleToggleRead(n)}
                  className={cn(
                    'group p-4 flex items-start gap-3.5 hover:bg-bg-canvas/50 transition-colors cursor-pointer',
                    n.unread && 'bg-brand-primary/[0.02]',
                    busy && 'opacity-50 pointer-events-none'
                  )}
                >
                  <div className={cn('p-2 rounded-btn shrink-0', iconColor)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-xs font-heading font-semibold text-text-primary', n.unread && 'font-bold')}>
                        {n.title}
                      </span>
                      <span className="text-[10px] text-text-tertiary tabular-nums font-heading shrink-0">{timeAgo(n.time)}</span>
                    </div>
                    {n.desc && <p className="text-xs text-text-secondary mt-1 leading-relaxed">{n.desc}</p>}
                  </div>

                  {/* Unread dot by default; on hover, both rows swap to actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="flex group-hover:hidden items-center w-5 h-5 justify-center">
                      {n.unread && <div className="w-1.5 h-1.5 bg-brand-primary rounded-full" />}
                    </div>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        title={n.unread ? 'Mark as read' : 'Mark as unread'}
                        onClick={(e) => { e.stopPropagation(); handleToggleRead(n); }}
                        className="p-1 rounded text-text-tertiary hover:text-brand-primary hover:bg-bg-canvas transition"
                      >
                        <Circle className={cn('w-3.5 h-3.5', n.unread && 'fill-current')} />
                      </button>
                      <button
                        title="Delete"
                        onClick={(e) => handleDelete(n, e)}
                        className="p-1 rounded text-text-tertiary hover:text-status-danger hover:bg-status-danger-bg transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
