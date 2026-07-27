import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button } from './ui/core';
import { Search, Loader2, Users, Mail, UserPlus } from 'lucide-react';
import { getAllLeadsWithEmail } from '../services/sourcingApi';
import type { EmailRecipient } from './EmailComposeModal';
import { AddAdHocRecipientModal } from './AddAdHocRecipientModal';

interface LeadPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: (recipients: EmailRecipient[]) => void;
  /** Ids already present elsewhere (e.g. already added to an in-progress
   * compose) — hidden here so the same lead can't be added twice. */
  excludeIds?: string[];
  /** Overrides the footer's primary action label — e.g. "Add" when this
   * picker is appending to an existing recipient list rather than starting one. */
  continueLabel?: string;
}

// Recipient picker used by both the Job Queue and Unified Inbox "Compose
// email" entry points — lets the user reach any lead with a real email
// address across every job, not just the one they happen to have open.
export const LeadPickerModal: React.FC<LeadPickerModalProps> = ({ isOpen, onClose, onContinue, excludeIds, continueLabel }) => {
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<EmailRecipient[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOwnOpen, setAddOwnOpen] = useState(false);

  const fetchLeads = () => {
    setLoading(true);
    // Loads every lead with an email address in the current workspace —
    // previously capped at 200 (getLeads()'s hardcoded pageSize), silently
    // hiding leads beyond that in larger workspaces.
    getAllLeadsWithEmail()
      .then((data) => {
        const mapped: EmailRecipient[] = (data || [])
          .filter((l: any) => !!l.decisionMaker?.email)
          .map((l: any) => ({
            id: l.id,
            name: l.decisionMaker?.full_name || 'Unknown contact',
            email: l.decisionMaker.email,
            company: l.company?.name || 'Unknown company',
            title: l.decisionMaker?.designation || undefined,
          }));
        setLeads(mapped);
      })
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setSelected(new Set());
    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleAddedOwnRecipient = (recipient: EmailRecipient) => {
    setAddOwnOpen(false);
    setLeads((prev) => [recipient, ...prev]);
    setSelected((prev) => new Set(prev).add(recipient.id));
  };

  const excludeSet = useMemo(() => new Set(excludeIds || []), [excludeIds]);

  const filtered = useMemo(() => {
    const base = excludeSet.size > 0 ? leads.filter((l) => !excludeSet.has(l.id)) : leads;
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (l) => l.name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q)
    );
  }, [leads, search, excludeSet]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((l) => next.delete(l.id));
      else filtered.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const handleContinue = () => {
    const recipients = leads.filter((l) => selected.has(l.id));
    onContinue(recipients);
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select recipients"
      size="lg"
      footer={
        <>
          <span className="text-xs text-text-tertiary">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleContinue} disabled={selected.size === 0}>
              {continueLabel || 'Continue'}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, company, or email..."
              className="pl-8 pr-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => setAddOwnOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-heading font-semibold text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/5 rounded-input transition"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add your own
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-text-secondary text-xs">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading leads...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-text-tertiary">
            <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-heading font-semibold text-text-secondary">
              {leads.length === 0
                ? 'No leads with an email address yet'
                : excludeSet.size >= leads.length
                ? 'Every lead with an email is already on this list'
                : 'No leads match your search'}
            </p>
            <p className="text-xs mt-1">
              {leads.length === 0 ? 'Run a search from Lead Search to find contacts first.' : 'Try a different search term.'}
            </p>
          </div>
        ) : (
          <div className="border border-border-default rounded-card overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-bg-canvas border-b border-border-default font-heading font-semibold uppercase text-[10px] text-text-secondary">
                  <tr>
                    <th className="p-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAllFiltered}
                        className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                      />
                    </th>
                    <th className="p-2.5">Name</th>
                    <th className="p-2.5">Company</th>
                    <th className="p-2.5">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {filtered.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => toggle(l.id)}
                      className={`cursor-pointer hover:bg-bg-canvas/50 transition ${selected.has(l.id) ? 'bg-brand-primary/[0.04]' : ''}`}
                    >
                      <td className="p-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(l.id)}
                          onChange={() => toggle(l.id)}
                          className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                        />
                      </td>
                      <td className="p-2.5 font-heading font-semibold text-text-primary">{l.name}</td>
                      <td className="p-2.5 text-text-secondary">{l.company}</td>
                      <td className="p-2.5 text-text-secondary font-mono">
                        <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-text-tertiary shrink-0" />{l.email}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>

    {/* Rendered as a sibling (not a Modal child) — its own fixed overlay
        shouldn't be affected by the parent Modal's transform/animation,
        same pattern EmailComposeModal uses for its own nested picker. */}
    <AddAdHocRecipientModal
      isOpen={addOwnOpen}
      onClose={() => setAddOwnOpen(false)}
      onAdded={handleAddedOwnRecipient}
    />
    </>
  );
};
