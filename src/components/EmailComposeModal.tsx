import React, { useState, useEffect, useRef } from 'react';
import { Button, Modal } from './ui/core';
import { Send, AlertCircle, Paperclip, X, Loader2, FileText, ChevronLeft, ChevronRight, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { sendColdEmails, sendColdEmailsSeparately, uploadAttachment, listTemplates } from '../services/sourcingApi';
import type { EmailAttachmentRef, TemplateRecord, PerRecipientEmail } from '../services/sourcingApi';
import { LeadPickerModal } from './LeadPickerModal';

export interface EmailRecipient {
  id: string;
  name: string;
  email?: string;
  company: string;
  title?: string;
}

interface EmailComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipients: EmailRecipient[];
  onSent?: (result: { sent: number; failed: number }) => void;
}

interface PendingAttachment {
  id: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  ref?: EmailAttachmentRef;
  error?: string;
}

interface Draft {
  subject: string;
  body: string;
}

const TOKENS: { label: string; token: string }[] = [
  { label: 'First name', token: '{{first_name}}' },
  { label: 'Full name', token: '{{name}}' },
  { label: 'Company', token: '{{company}}' },
  { label: 'Title', token: '{{title}}' },
];

const DEFAULT_SUBJECT = 'Quick question about {{company}}';
const DEFAULT_BODY = `Hi {{first_name}},

I came across {{company}} and wanted to reach out directly.

Would you be open to a short conversation this week?

Best,`;

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Client-side mirror of the backend's personalize() in messages.py — used
// only to preview each recipient's resolved copy in the "Send separately"
// carousel before it's sent; the backend re-resolves tokens authoritatively
// on send, so this never needs to be perfectly in sync.
function personalizeText(text: string, recipient: EmailRecipient): string {
  if (!text) return text;
  const fullName = recipient.name && recipient.name !== 'Not identified' ? recipient.name : undefined;
  const firstName = fullName ? fullName.split(' ')[0] : 'there';
  const replacements: Record<string, string> = {
    '{{first_name}}': firstName,
    '{{name}}': fullName || 'there',
    '{{company}}': recipient.company && recipient.company !== 'Unknown company' ? recipient.company : 'your company',
    '{{title}}': recipient.title || '',
    '{{designation}}': recipient.title || '',
  };
  let result = text;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value);
  }
  return result;
}

export const EmailComposeModal: React.FC<EmailComposeModalProps> = ({ isOpen, onClose, recipients, onSent }) => {
  const [mode, setMode] = useState<'together' | 'separate'>('together');
  const [allRecipients, setAllRecipients] = useState<EmailRecipient[]>(recipients);
  const [addPickerOpen, setAddPickerOpen] = useState(false);

  // Together mode fields, and also the template baseline that "Send
  // separately" personalizes per recipient the moment a recipient is
  // viewed (see currentDraft below) — never a raw {{token}}.
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);

  // Separate mode: one draft per recipient id, created lazily the first
  // time that recipient's fields are edited. Until then, the effective
  // subject/body is the template above personalized for that recipient.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [carouselIndex, setCarouselIndex] = useState(0);

  const [showCc, setShowCc] = useState(false);
  const [ccInput, setCcInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode('together');
      setAllRecipients(recipients);
      setDrafts({});
      setCarouselIndex(0);
      setSubject(DEFAULT_SUBJECT);
      setBody(DEFAULT_BODY);
      setShowCc(false);
      setCcInput('');
      setAttachments([]);
      setSelectedTemplateId('');
      listTemplates()
        .then((res) => setTemplates(res.data || []))
        .catch(() => setTemplates([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setSubject(DEFAULT_SUBJECT);
      setBody(DEFAULT_BODY);
      setDrafts({});
      return;
    }
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      setSubject(tpl.subject || '');
      setBody(tpl.body);
      // Reset per-recipient edits so everyone starts from the new
      // template — each still gets it personalized to them, lazily.
      setDrafts({});
    }
  };

  const withEmail = allRecipients.filter((r) => !!r.email);
  const withoutEmail = allRecipients.filter((r) => !r.email);

  const safeIndex = Math.min(carouselIndex, Math.max(0, withEmail.length - 1));
  const currentRecipient = withEmail[safeIndex] || null;
  const currentDraft: Draft = currentRecipient
    ? drafts[currentRecipient.id] || { subject: personalizeText(subject, currentRecipient), body: personalizeText(body, currentRecipient) }
    : { subject: '', body: '' };

  const updateCurrentDraft = (patch: Partial<Draft>) => {
    if (!currentRecipient) return;
    setDrafts((prev) => ({ ...prev, [currentRecipient.id]: { ...currentDraft, ...patch } }));
  };

  const goPrevRecipient = () => setCarouselIndex((i) => Math.max(0, i - 1));
  const goNextRecipient = () => setCarouselIndex((i) => Math.min(withEmail.length - 1, i + 1));

  const handleAddRecipients = (added: EmailRecipient[]) => {
    setAddPickerOpen(false);
    if (added.length === 0) return;
    setAllRecipients((prev) => [...prev, ...added]);
    toast.success(`Added ${added.length} recipient${added.length === 1 ? '' : 's'}.`);
  };

  const ccList = ccInput
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const invalidCc = ccList.filter((addr) => !EMAIL_RE.test(addr));

  const insertToken = (token: string) => {
    setBody((prev) => (prev ? `${prev} ${token}` : token));
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is too large (${formatBytes(file.size)}) — the limit is 15MB per file.`);
        return;
      }

      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setAttachments((prev) => [...prev, { id, file, status: 'uploading' }]);

      uploadAttachment(file)
        .then((ref) => {
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'done', ref } : a)));
        })
        .catch((e: any) => {
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'error', error: e?.message || 'Upload failed' } : a)));
        });
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const uploadingCount = attachments.filter((a) => a.status === 'uploading').length;

  const handleSend = async () => {
    if (withEmail.length === 0) {
      toast.error('None of the selected leads have an email address on file.');
      return;
    }
    if (mode === 'together' && (!subject.trim() || !body.trim())) {
      toast.error('Subject and message body are both required.');
      return;
    }
    if (invalidCc.length > 0) {
      toast.error(`Invalid Cc address: ${invalidCc[0]}`);
      return;
    }
    if (uploadingCount > 0) {
      toast.error('Wait for attachments to finish uploading before sending.');
      return;
    }
    const failedAttachments = attachments.filter((a) => a.status === 'error');
    if (failedAttachments.length > 0) {
      toast.error(`Remove or retry the attachment that failed to upload: ${failedAttachments[0].file.name}`);
      return;
    }

    setSending(true);
    try {
      const attachmentRefs = attachments.filter((a) => a.status === 'done' && a.ref).map((a) => a.ref!);
      let result: { sent: number; failed: number };

      if (mode === 'separate') {
        const messages: PerRecipientEmail[] = withEmail.map((r) => {
          const d = drafts[r.id];
          return {
            leadId: r.id,
            subject: (d?.subject ?? personalizeText(subject, r)).trim(),
            body: (d?.body ?? personalizeText(body, r)).trim(),
          };
        });
        const emptyOne = messages.find((m) => !m.subject || !m.body);
        if (emptyOne) {
          const name = withEmail.find((r) => r.id === emptyOne.leadId)?.name || 'a recipient';
          toast.error(`Subject and message body are required for ${name}.`);
          setSending(false);
          return;
        }
        result = await sendColdEmailsSeparately(messages, ccList, attachmentRefs, selectedTemplateId || null);
      } else {
        result = await sendColdEmails(withEmail.map((r) => r.id), subject, body, ccList, attachmentRefs, selectedTemplateId || null);
      }

      if (result.failed === 0) {
        toast.success(`Sent to ${result.sent} recipient${result.sent === 1 ? '' : 's'}.`);
      } else if (result.sent === 0) {
        toast.error(`All ${result.failed} email${result.failed === 1 ? '' : 's'} failed to send.`);
      } else {
        toast.warning(`Sent ${result.sent} of ${result.sent + result.failed} — ${result.failed} failed.`);
      }
      onSent?.(result);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={allRecipients.length === 1 ? `Email ${allRecipients[0]?.name}` : `Email ${allRecipients.length} leads`}
      size="lg"
      footer={
        <>
          <span className="text-xs text-text-tertiary">
            {withEmail.length} recipient{withEmail.length === 1 ? '' : 's'}
            {withoutEmail.length > 0 && ` · ${withoutEmail.length} skipped (no email)`}
            {attachments.length > 0 && ` · ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSend} loading={sending} disabled={withEmail.length === 0 || uploadingCount > 0}>
              <Send className="w-3.5 h-3.5 mr-1.5" /> Send
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        {/* Send mode toggle */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Send mode</label>
          <div className="inline-flex rounded-input border border-border-default overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('together')}
              className={`px-3 py-1.5 text-xs font-heading font-semibold transition ${
                mode === 'together' ? 'bg-brand-primary text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'
              }`}
            >
              Send to everyone at once
            </button>
            <button
              type="button"
              onClick={() => setMode('separate')}
              className={`px-3 py-1.5 text-xs font-heading font-semibold transition border-l border-border-default ${
                mode === 'separate' ? 'bg-brand-primary text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'
              }`}
            >
              Write one-by-one
            </button>
          </div>
          <p className="text-[11px] text-text-tertiary mt-1.5">
            {mode === 'together'
              ? 'One message, personalized per recipient automatically on send.'
              : 'Step through each recipient and edit their message individually — already filled in with their real details.'}
          </p>
        </div>

        {/* Recipients */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-heading font-semibold text-text-secondary">To</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAddPickerOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-brand-primary transition"
              >
                <UserPlus className="w-3 h-3" /> Add recipient
              </button>
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-[11px] text-text-tertiary hover:text-brand-primary transition"
                >
                  Add Cc
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-bg-canvas rounded-input border border-border-default">
            {withEmail.map((r) => (
              <span key={r.id} className="inline-flex items-center text-xs bg-bg-surface border border-border-default px-2 py-0.5 rounded-badge text-text-primary">
                {r.name} <span className="text-text-tertiary ml-1">· {r.email}</span>
              </span>
            ))}
            {withEmail.length === 0 && (
              <span className="text-xs text-text-tertiary italic px-1 py-0.5">No selected leads have an email address.</span>
            )}
          </div>
          {withoutEmail.length > 0 && (
            <p className="flex items-center gap-1 text-[11px] text-text-tertiary mt-1.5">
              <AlertCircle className="w-3 h-3 shrink-0" />
              {withoutEmail.length} selected lead{withoutEmail.length === 1 ? '' : 's'} skipped — no email on file: {withoutEmail.slice(0, 3).map((r) => r.name).join(', ')}{withoutEmail.length > 3 ? ` +${withoutEmail.length - 3} more` : ''}
            </p>
          )}
        </div>

        {/* Cc */}
        {showCc && (
          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Cc</label>
            <input
              type="text"
              value={ccInput}
              onChange={(e) => setCcInput(e.target.value)}
              placeholder="name@example.com, another@example.com"
              className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
            {invalidCc.length > 0 && ccInput.trim() && (
              <p className="text-[11px] text-status-error mt-1">Not a valid address: {invalidCc[0]}</p>
            )}
          </div>
        )}

        {/* Template picker */}
        {templates.length > 0 && (
          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Start from a template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            >
              <option value="">Blank message / Default</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.type})</option>
              ))}
            </select>
          </div>
        )}

        {mode === 'separate' ? (
          withEmail.length === 0 ? (
            <div className="text-xs text-text-secondary italic text-center py-6 bg-bg-canvas rounded-card border border-border-subtle">
              No recipients with an email address to compose for yet.
            </div>
          ) : (
            <>
              {/* Carousel nav */}
              <div className="flex items-center justify-between bg-bg-canvas border border-border-default rounded-input px-2 py-1.5">
                <button
                  type="button"
                  onClick={goPrevRecipient}
                  disabled={safeIndex === 0}
                  className="p-1 rounded text-text-secondary hover:text-brand-primary hover:bg-bg-surface transition disabled:opacity-30 disabled:pointer-events-none"
                  title="Previous recipient"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="flex items-center gap-1.5 text-xs font-heading font-semibold text-text-primary">
                  <Users className="w-3.5 h-3.5 text-text-tertiary" />
                  Recipient {safeIndex + 1} of {withEmail.length} — {currentRecipient?.name}, {currentRecipient?.company}
                </span>
                <button
                  type="button"
                  onClick={goNextRecipient}
                  disabled={safeIndex >= withEmail.length - 1}
                  className="p-1 rounded text-text-secondary hover:text-brand-primary hover:bg-bg-surface transition disabled:opacity-30 disabled:pointer-events-none"
                  title="Next recipient"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Per-recipient subject */}
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">
                  Subject <span className="text-text-tertiary font-normal">— for {currentRecipient?.name}</span>
                </label>
                <input
                  type="text"
                  value={currentDraft.subject}
                  onChange={(e) => updateCurrentDraft({ subject: e.target.value })}
                  className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
              </div>

              {/* Per-recipient body */}
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">
                  Message <span className="text-text-tertiary font-normal">— for {currentRecipient?.name}</span>
                </label>
                <textarea
                  rows={9}
                  value={currentDraft.body}
                  onChange={(e) => updateCurrentDraft({ body: e.target.value })}
                  className="w-full text-sm p-3 bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary font-sans leading-relaxed"
                />
                <p className="text-[11px] text-text-tertiary mt-1.5">
                  Already filled in with {currentRecipient?.name}'s real details — edit freely, it only changes this recipient's copy.
                </p>
              </div>
            </>
          )
        ) : (
          <>
            {/* Subject */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>

            {/* Body */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-heading font-semibold text-text-secondary">Message</label>
                <div className="flex items-center gap-1">
                  {TOKENS.map((t) => (
                    <button
                      key={t.token}
                      type="button"
                      onClick={() => insertToken(t.token)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border-default text-text-secondary hover:border-brand-primary hover:text-brand-primary transition"
                      title={`Insert ${t.label.toLowerCase()}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                rows={9}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full text-sm p-3 bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary font-sans leading-relaxed"
              />
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {'{{first_name}}'}, {'{{company}}'} and {'{{title}}'} are replaced with each recipient's own real details before sending — every recipient gets a personalized copy, not a literal token.
              </p>
            </div>
          </>
        )}

        {/* Attachments */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-heading font-semibold text-text-secondary">Attachments</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-brand-primary transition"
            >
              <Paperclip className="w-3 h-3" /> Attach files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
          </div>
          {attachments.length > 0 && (
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-bg-canvas border border-border-default rounded-input text-xs"
                >
                  <span className="flex items-center gap-1.5 min-w-0 text-text-primary">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                    <span className="truncate">{a.file.name}</span>
                    <span className="text-text-tertiary shrink-0">{formatBytes(a.file.size)}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {a.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-text-tertiary" />}
                    {a.status === 'error' && <span className="text-status-error text-[11px]">{a.error || 'Failed'}</span>}
                    <button type="button" onClick={() => removeAttachment(a.id)} className="text-text-tertiary hover:text-status-error transition">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>

    {/* Nested picker for adding more recipients without leaving compose —
        rendered as a sibling (not a Modal child) so its own fixed overlay
        isn't affected by the parent Modal's transform/animation. */}
    <LeadPickerModal
      isOpen={addPickerOpen}
      onClose={() => setAddPickerOpen(false)}
      onContinue={handleAddRecipients}
      excludeIds={allRecipients.map((r) => r.id)}
      continueLabel="Add"
    />
    </>
  );
};
