import React, { useEffect, useState } from 'react';
import { Modal, Button } from './ui/core';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { createAdHocLead } from '../services/sourcingApi';
import type { EmailRecipient } from './EmailComposeModal';

interface AddAdHocRecipientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (recipient: EmailRecipient) => void;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// "Add your own" — types a recipient not already in the lead list. Saved as
// a real Lead (Company/Contact/Lead row) in the current workspace via
// POST /leads/adhoc, so it's fully real data — visible afterward in All
// Leads/Lead Validation, fully auditable — rather than a send-only record.
export const AddAdHocRecipientModal: React.FC<AddAdHocRecipientModalProps> = ({ isOpen, onClose, onAdded }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setEmail('');
      setCompany('');
      setTitle('');
    }
  }, [isOpen]);

  const emailValid = EMAIL_RE.test(email.trim());

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Enter a name.');
      return;
    }
    if (!emailValid) {
      toast.error('Enter a valid email address.');
      return;
    }

    setSaving(true);
    try {
      const lead = await createAdHocLead({
        name: name.trim(),
        email: email.trim(),
        company: company.trim() || undefined,
        title: title.trim() || undefined,
      });
      const recipient: EmailRecipient = {
        id: lead.id,
        name: lead.decisionMaker?.full_name || name.trim(),
        email: lead.decisionMaker?.email || email.trim(),
        company: lead.company?.name || company.trim() || 'Unknown company',
        title: lead.decisionMaker?.designation || title.trim() || undefined,
      };
      onAdded(recipient);
      toast.success(`Added ${recipient.name} as a recipient.`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to add recipient.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add your own recipient"
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving} icon={UserPlus}>
            Add recipient
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-text-secondary">
          Type someone directly — they'll be saved as a real lead in this workspace so this send (and any future ones) has a genuine record.
        </p>

        <div>
          <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Name</label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jordan Lee"
            className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
        </div>

        <div>
          <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jordan@company.com"
            className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
          {email.trim() && !emailValid && (
            <p className="text-[11px] text-status-error mt-1">Enter a valid email address.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Company <span className="text-text-tertiary font-normal">(optional)</span></label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Inc."
              className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Title <span className="text-text-tertiary font-normal">(optional)</span></label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VP of Sales"
              className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};
