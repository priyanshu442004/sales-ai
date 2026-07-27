import React, { useCallback, useEffect, useState } from 'react';
import { Card, Button, Badge, Modal, Avatar } from '../components/ui/core';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UserPlus, Trash2, Plus, X, Dices, Eye, EyeOff, Ban, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { listTeam, inviteTeammates, updateTeammate, deleteTeammate } from '../services/sourcingApi';
import type { TeamInviteItem } from '../services/sourcingApi';
import { useUiStore } from '../store/useUiStore';

interface Teammate {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Sales Manager' | 'Sales Rep' | 'Reviewer-only';
  status: 'Active' | 'Invited' | 'Suspended';
  lastActive: string;
  avatarUrl?: string;
}

interface InviteRow {
  key: string;
  email: string;
  name: string;
  password: string;
  role: 'Admin' | 'Sales Manager' | 'Sales Rep' | 'Reviewer-only';
  showPassword: boolean;
}

const ROLE_OPTIONS = ['Admin', 'Sales Manager', 'Sales Rep', 'Reviewer-only'] as const;

// A real random password, not a placeholder — the workspace admin can still
// see and edit it before sending, since they're the one who "sets" it.
function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function newInviteRow(): InviteRow {
  return {
    key: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    email: '',
    name: '',
    password: generatePassword(),
    role: 'Sales Rep',
    showPassword: false,
  };
}

export const Team: React.FC = () => {
  const currentUser = useUiStore((s) => s.currentUser);
  const [members, setMembers] = useState<Teammate[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([newInviteRow()]);

  const [confirmDelete, setConfirmDelete] = useState<Teammate | null>(null);

  const canManageTeam = currentUser?.role === 'Admin' || currentUser?.role === 'Sales Manager';
  const canEditRoles = currentUser?.role === 'Admin';

  const fetchTeam = useCallback(async () => {
    try {
      const res = await listTeam();
      setMembers(res?.data || []);
    } catch (e: any) {
      console.error('Failed to load team:', e.message);
      toast.error('Failed to load team members.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const setRowWorking = (id: string, working: boolean) => {
    setWorkingIds((prev) => {
      const next = new Set(prev);
      if (working) next.add(id); else next.delete(id);
      return next;
    });
  };

  // ─── Invite modal ────────────────────────────────────────────────────────
  const openInviteModal = () => {
    setInviteRows([newInviteRow()]);
    setModalOpen(true);
  };

  const updateRow = (key: string, patch: Partial<InviteRow>) => {
    setInviteRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => setInviteRows((prev) => [...prev, newInviteRow()]);
  const removeRow = (key: string) => setInviteRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));

  const handleSendInvites = async () => {
    const rows = inviteRows.filter((r) => r.email.trim());
    if (rows.length === 0) {
      toast.error('Enter at least one email address.');
      return;
    }
    const tooShort = rows.find((r) => r.password.length < 8);
    if (tooShort) {
      toast.error(`Password for ${tooShort.email} must be at least 8 characters.`);
      return;
    }

    setInviting(true);
    try {
      const payload: TeamInviteItem[] = rows.map((r) => ({
        email: r.email.trim(),
        password: r.password,
        role: r.role,
        name: r.name.trim() || undefined,
      }));
      const res = await inviteTeammates(payload);

      const failed = res.results.filter((r) => !r.success);
      const noEmail = res.results.filter((r) => r.success && !r.emailSent);

      if (res.invited > 0) {
        toast.success(`Invited ${res.invited} of ${res.total} teammate${res.total > 1 ? 's' : ''}.`);
      }
      failed.forEach((r) => toast.error(`${r.email}: ${r.error}`));
      noEmail.forEach((r) => toast.warning(`${r.email} was added but the invite email failed to send: ${r.error}`));

      if (res.invited > 0) {
        setModalOpen(false);
        fetchTeam();
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invites.');
    } finally {
      setInviting(false);
    }
  };

  // ─── Role / status changes ───────────────────────────────────────────────
  const handleRoleChange = async (member: Teammate, role: Teammate['role']) => {
    setRowWorking(member.id, true);
    try {
      await updateTeammate(member.id, { role });
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)));
      toast.success(`${member.name}'s role updated to ${role}.`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update role.');
    } finally {
      setRowWorking(member.id, false);
    }
  };

  const handleToggleSuspend = async (member: Teammate) => {
    const nextStatus = member.status === 'Suspended' ? 'Active' : 'Suspended';
    setRowWorking(member.id, true);
    try {
      await updateTeammate(member.id, { status: nextStatus });
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, status: nextStatus } : m)));
      toast.success(nextStatus === 'Suspended' ? `${member.name} has been suspended.` : `${member.name} has been reactivated.`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status.');
    } finally {
      setRowWorking(member.id, false);
    }
  };

  const handleDelete = (member: Teammate) => setConfirmDelete(member);

  const confirmDeleteMember = async () => {
    if (!confirmDelete) return;
    const member = confirmDelete;
    setConfirmDelete(null);
    setRowWorking(member.id, true);
    try {
      await deleteTeammate(member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      toast.warning(`Removed ${member.name} from the workspace.`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove team member.');
    } finally {
      setRowWorking(member.id, false);
    }
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Team Members & Permissions</h1>
          <p className="text-xs text-text-secondary mt-1">Invite colleagues into your workspace, assign roles, and manage access.</p>
        </div>
        {canManageTeam && (
          <Button variant="primary" onClick={openInviteModal}>
            <UserPlus className="w-4 h-4 mr-2" /> Invite Teammates
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="text-center py-16">
            <Loader2 className="w-8 h-8 text-text-tertiary mx-auto animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-bg-canvas border-b border-border-default text-xs font-heading font-semibold text-text-secondary uppercase">
                <tr>
                  <th className="p-4 font-semibold">User</th>
                  <th className="p-4 font-semibold">Email</th>
                  <th className="p-4 font-semibold">Status</th>
                  <th className="p-4 font-semibold">Last Active</th>
                  <th className="p-4 font-semibold">Role Privilege</th>
                  <th className="p-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-xs">
                {members.map(m => {
                  const isSelf = m.id === currentUser?.id;
                  const busy = workingIds.has(m.id);
                  return (
                    <tr key={m.id} className="hover:bg-bg-canvas/40 transition">
                      <td className="p-4">
                        <div className="flex items-center space-x-3">
                          <Avatar name={m.name} src={m.avatarUrl} size="sm" />
                          <span className="font-heading font-semibold text-text-primary text-sm">{m.name}{isSelf && <span className="text-text-tertiary font-normal"> (you)</span>}</span>
                        </div>
                      </td>
                      <td className="p-4 text-text-secondary">{m.email}</td>
                      <td className="p-4">
                        <Badge variant={m.status === 'Active' ? 'success' : m.status === 'Suspended' ? 'danger' : 'neutral'}>{m.status}</Badge>
                      </td>
                      <td className="p-4 text-text-secondary">{m.lastActive}</td>
                      <td className="p-4">
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m, e.target.value as Teammate['role'])}
                          disabled={!canEditRoles || isSelf || busy}
                          className="px-2.5 py-1 text-xs bg-bg-surface border border-border-default rounded text-text-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className="p-4 text-right space-x-1">
                        {canEditRoles && (
                          <Button
                            variant="ghost" size="sm" className="text-xs px-2 h-8"
                            title={m.status === 'Suspended' ? 'Reactivate' : 'Suspend'}
                            disabled={isSelf || busy}
                            onClick={() => handleToggleSuspend(m)}
                          >
                            {m.status === 'Suspended' ? <RotateCcw className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                        {canEditRoles && (
                          <Button
                            variant="ghost" size="sm" className="text-xs text-status-danger px-2 h-8"
                            title="Remove from workspace"
                            disabled={isSelf || busy}
                            onClick={() => handleDelete(m)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Invite modal — supports multiple recipients in one go, each with
          their own admin-set password and role. */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Invite Teammates" size="lg">
        <div className="space-y-4">
          <p className="text-xs text-text-secondary">
            Set a password and role for each teammate — they'll receive their login email and this exact password by email, and can only access this workspace.
          </p>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {inviteRows.map((row, idx) => (
              <div key={row.key} className="p-3 bg-bg-canvas rounded-card border border-border-subtle space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-heading font-semibold text-text-tertiary uppercase tracking-wider">Teammate {idx + 1}</span>
                  {inviteRows.length > 1 && (
                    <button type="button" onClick={() => removeRow(row.key)} className="text-text-tertiary hover:text-status-danger">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="email"
                    value={row.email}
                    onChange={(e) => updateRow(row.key, { email: e.target.value })}
                    placeholder="colleague@company.com"
                    className="px-3 py-2 text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary col-span-2 sm:col-span-1"
                  />
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                    placeholder="Full name (optional)"
                    className="px-3 py-2 text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary col-span-2 sm:col-span-1"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      type={row.showPassword ? 'text' : 'password'}
                      value={row.password}
                      onChange={(e) => updateRow(row.key, { password: e.target.value })}
                      placeholder="Password (min 8 chars)"
                      className="px-3 py-2 pr-16 w-full text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary font-mono"
                    />
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                      <button type="button" title="Generate password" onClick={() => updateRow(row.key, { password: generatePassword() })} className="p-1 text-text-tertiary hover:text-brand-primary">
                        <Dices className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title={row.showPassword ? 'Hide' : 'Show'} onClick={() => updateRow(row.key, { showPassword: !row.showPassword })} className="p-1 text-text-tertiary hover:text-brand-primary">
                        {row.showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <select
                    value={row.role}
                    onChange={(e) => updateRow(row.key, { role: e.target.value as InviteRow['role'] })}
                    className="px-3 py-2 text-xs bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none"
                  >
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-xs text-brand-primary hover:underline font-heading font-semibold">
            <Plus className="w-3.5 h-3.5" /> Add another teammate
          </button>

          <div className="flex justify-end space-x-2 border-t border-border-subtle pt-3">
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)} disabled={inviting}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSendInvites} disabled={inviting} icon={inviting ? Loader2 : UserPlus}>
              {inviting ? 'Sending...' : 'Send Invitation(s)'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title="Remove team member"
        message={confirmDelete ? `Remove ${confirmDelete.name} (${confirmDelete.email}) from this workspace? They will immediately lose access. This can't be undone.` : ''}
        confirmLabel="Remove"
        onConfirm={confirmDeleteMember}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};
