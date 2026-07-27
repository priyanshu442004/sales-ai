import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Card, Badge, Avatar, Tabs } from '../components/ui/core';
import {
  Inbox as InboxIcon, MessageSquare, Send, Mail, AlertCircle, Loader2,
  ChevronDown, ChevronRight, Paperclip, Users
} from 'lucide-react';
import { toast } from 'sonner';
import { getMessages, getConversations, sendInboxReply, updateThreadSentiment, listTemplates } from '../services/sourcingApi';
import type { TemplateRecord } from '../services/sourcingApi';
import { EmailComposeModal } from '../components/EmailComposeModal';
import type { EmailRecipient } from '../components/EmailComposeModal';
import { LeadPickerModal } from '../components/LeadPickerModal';

type Sentiment = 'Positive' | 'Neutral' | 'Negative' | 'Out-of-office';

interface Thread {
  id: string;
  leadId: string;
  senderName: string;
  senderEmail: string | null;
  companyName: string;
  snippet: string;
  sentiment: Sentiment;
  time: string | null;
  history: {
    from: string;
    body: string;
    date: string;
    direction: 'inbound' | 'outbound';
  }[];
}

interface EmailAttachmentMeta {
  filename: string;
  url?: string;
  size?: number;
  contentType?: string;
}

interface SentEmail {
  id: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  leadEmail: string | null;
  subject: string | null;
  body: string;
  status: string;
  errorDetail: string | null;
  cc: string[];
  attachments: EmailAttachmentMeta[];
  batchId: string | null;
  sentBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface SendBatch {
  key: string;
  batchId: string | null;
  subject: string | null;
  body: string;
  cc: string[];
  attachments: EmailAttachmentMeta[];
  sentBy: string | null;
  timestamp: string;
  messages: SentEmail[];
  sentCount: number;
  failedCount: number;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mapConversation(raw: any): Thread {
  return {
    id: raw.id,
    leadId: raw.leadId || '',
    senderName: raw.leadName || 'Unknown contact',
    senderEmail: raw.leadEmail || null,
    companyName: raw.companyName || 'Unknown company',
    snippet: raw.lastMessageSnippet || '',
    sentiment: (raw.sentiment as Sentiment) || 'Neutral',
    time: raw.lastMessageTime || null,
    history: (raw.messages || []).map((m: any) => ({
      from: m.senderName || (m.direction === 'inbound' ? raw.leadName : 'You'),
      body: m.body,
      date: m.timestamp,
      direction: m.direction,
    })),
  };
}

export const Inbox: React.FC = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [filterPositiveOnly, setFilterPositiveOnly] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // Sent Emails tab — real cold-email deliveries from the Job Queue send flow
  const [activeTab, setActiveTab] = useState<'replies' | 'sent'>('replies');
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [loadingSent, setLoadingSent] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeRecipients, setComposeRecipients] = useState<EmailRecipient[]>([]);

  const [templates, setTemplates] = useState<TemplateRecord[]>([]);

  useEffect(() => {
    listTemplates()
      .then((res) => setTemplates(res.data || []))
      .catch(() => setTemplates([]));
  }, []);

  const handlePickerContinue = (recipients: EmailRecipient[]) => {
    setPickerOpen(false);
    setComposeRecipients(recipients);
    setComposeOpen(true);
  };

  const handleComposeSent = () => {
    setActiveTab('sent');
    fetchSentEmails();
  };

  const fetchThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const res = await getConversations();
      const mapped = (res?.data || []).map(mapConversation);
      setThreads(mapped);
      setSelectedThreadId((prev) => {
        if (prev && mapped.some((t) => t.id === prev)) return prev;
        return mapped[0]?.id || null;
      });
    } catch {
      toast.error('Failed to load reply threads.');
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  const fetchSentEmails = useCallback(async () => {
    setLoadingSent(true);
    try {
      const res = await getMessages();
      const emails = (res?.data || []).filter((m: any) => m.channel === 'email' && (m.status === 'sent' || m.status === 'failed'));
      emails.sort((a: any, b: any) => new Date(b.sentAt || b.createdAt).getTime() - new Date(a.sentAt || a.createdAt).getTime());
      setSentEmails(emails);
    } catch {
      toast.error('Failed to load sent emails.');
    } finally {
      setLoadingSent(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    if (activeTab === 'sent') fetchSentEmails();
  }, [activeTab, fetchSentEmails]);

  // Bulk sends share a batchId — group those into one send event; a message
  // with no batchId was sent individually and stands as its own event.
  const sendBatches = useMemo<SendBatch[]>(() => {
    const groups = new Map<string, SentEmail[]>();
    for (const m of sentEmails) {
      const key = m.batchId || `single:${m.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    const batches: SendBatch[] = Array.from(groups.entries()).map(([key, messages]) => {
      const first = messages[0];
      const timestamp = messages.reduce((latest, m) => {
        const t = m.sentAt || m.createdAt;
        return t > latest ? t : latest;
      }, messages[0].sentAt || messages[0].createdAt);
      return {
        key,
        batchId: first.batchId,
        subject: first.subject,
        body: first.body,
        cc: first.cc || [],
        attachments: first.attachments || [],
        sentBy: first.sentBy,
        timestamp,
        messages,
        sentCount: messages.filter((m) => m.status === 'sent').length,
        failedCount: messages.filter((m) => m.status === 'failed').length,
      };
    });

    return batches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [sentEmails]);

  const selectedThread = threads.find(t => t.id === selectedThreadId) || null;

  const filteredThreads = filterPositiveOnly
    ? threads.filter(t => t.sentiment === 'Positive')
    : threads;

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedThread) return;
    setSendingReply(true);
    try {
      await sendInboxReply(selectedThread.id, replyText);
      toast.success('Reply sent successfully.');
      setReplyText('');
      await fetchThreads();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send reply.');
    } finally {
      setSendingReply(false);
    }
  };

  const handleUpdateSentiment = async (threadId: string, sentiment: Sentiment) => {
    const prev = threads;
    setThreads((ts) => ts.map(t => t.id === threadId ? { ...t, sentiment } : t));
    try {
      await updateThreadSentiment(threadId, sentiment);
      toast.success(`Sentiment tag updated to ${sentiment}`);
    } catch (e: any) {
      setThreads(prev);
      toast.error(e?.message || 'Failed to update sentiment.');
    }
  };

  const getSentimentBadge = (sentiment: Sentiment) => {
    switch (sentiment) {
      case 'Positive':
        return <Badge variant="success">Positive Reply</Badge>;
      case 'Neutral':
        return <Badge variant="neutral">Neutral</Badge>;
      case 'Negative':
        return <Badge variant="danger">Negative</Badge>;
      case 'Out-of-office':
        return <Badge variant="warning">Out of Office</Badge>;
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Unified Inbox</h1>
          <p className="text-xs text-text-secondary mt-1">Review active reply threads, sentiment analysis flags, and coordinate follow-up bookings.</p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs
            tabs={[
              { id: 'replies', label: 'Reply Threads' },
              { id: 'sent', label: 'Sent Emails' },
            ]}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as 'replies' | 'sent')}
          />
          <Button variant="primary" onClick={() => setPickerOpen(true)}>
            <Send className="w-4 h-4 mr-2" /> Compose email
          </Button>
        </div>
      </div>

      {activeTab === 'sent' ? (
        <Card className="overflow-hidden">
          {loadingSent ? (
            <div className="flex items-center justify-center py-16 text-text-secondary text-xs">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading sent emails...
            </div>
          ) : sendBatches.length === 0 ? (
            <div className="text-center py-16 text-text-tertiary">
              <Mail className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-heading font-semibold text-text-secondary">No emails sent yet</p>
              <p className="text-xs mt-1">Compose one here, or select leads in the Job Queue and use "Send Email" — deliveries show up in this list.</p>
              <Button variant="primary" size="sm" className="mt-4" onClick={() => setPickerOpen(true)}>
                <Send className="w-3.5 h-3.5 mr-1.5" /> Compose email
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-bg-canvas border-b border-border-default font-heading font-semibold uppercase tracking-wider text-text-secondary">
                  <tr>
                    <th className="p-4 w-8"></th>
                    <th className="p-4">Recipients</th>
                    <th className="p-4">Subject</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Sent by</th>
                    <th className="p-4">Sent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {sendBatches.map((batch) => {
                    const isExpanded = expandedBatch === batch.key;
                    const isBulk = batch.messages.length > 1;
                    return (
                      <React.Fragment key={batch.key}>
                        <tr
                          className="hover:bg-bg-canvas/40 transition cursor-pointer"
                          onClick={() => setExpandedBatch(isExpanded ? null : batch.key)}
                        >
                          <td className="p-4 text-text-tertiary">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </td>
                          <td className="p-4">
                            {isBulk ? (
                              <span className="inline-flex items-center gap-1.5 font-heading font-semibold text-text-primary">
                                <Users className="w-3.5 h-3.5 text-text-tertiary" /> {batch.messages.length} recipients
                              </span>
                            ) : (
                              <>
                                <span className="font-heading font-semibold text-text-primary block">{batch.messages[0].leadName}</span>
                                <span className="text-[10px] text-text-secondary">{batch.messages[0].leadCompany}</span>
                              </>
                            )}
                            {batch.cc.length > 0 && (
                              <span className="text-[10px] text-text-tertiary block mt-0.5">Cc: {batch.cc.join(', ')}</span>
                            )}
                          </td>
                          <td className="p-4 text-text-secondary max-w-xs truncate">
                            <span className="flex items-center gap-1.5">
                              {batch.subject || '(no subject)'}
                              {batch.attachments.length > 0 && (
                                <Paperclip className="w-3 h-3 text-text-tertiary shrink-0" />
                              )}
                            </span>
                          </td>
                          <td className="p-4">
                            {batch.failedCount === 0 ? (
                              <Badge variant="success">{isBulk ? `${batch.sentCount} sent` : 'Sent'}</Badge>
                            ) : batch.sentCount === 0 ? (
                              <span className="inline-flex items-center gap-1" title={batch.messages.find(m => m.errorDetail)?.errorDetail || 'Delivery failed'}>
                                <Badge variant="danger">{isBulk ? `${batch.failedCount} failed` : 'Failed'}</Badge>
                                <AlertCircle className="w-3 h-3 text-status-danger" />
                              </span>
                            ) : (
                              <Badge variant="warning">{batch.sentCount} sent, {batch.failedCount} failed</Badge>
                            )}
                          </td>
                          <td className="p-4 text-text-secondary">{batch.sentBy || '—'}</td>
                          <td className="p-4 text-text-secondary">
                            {new Date(batch.timestamp).toLocaleString()}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="p-0 bg-bg-canvas/40">
                              <div className="p-4 space-y-4">
                                {/* Body */}
                                <div>
                                  <span className="text-[10px] font-heading font-semibold uppercase tracking-wider text-text-tertiary block mb-1">Message</span>
                                  <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed bg-bg-surface border border-border-default rounded-input p-3 max-w-2xl">
                                    {batch.body}
                                  </p>
                                </div>

                                {/* Attachments */}
                                {batch.attachments.length > 0 && (
                                  <div>
                                    <span className="text-[10px] font-heading font-semibold uppercase tracking-wider text-text-tertiary block mb-1">Attachments</span>
                                    <div className="flex flex-wrap gap-1.5">
                                      {batch.attachments.map((a, i) => (
                                        a.url ? (
                                          <a
                                            key={i}
                                            href={a.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="inline-flex items-center gap-1 text-[11px] bg-bg-surface border border-border-default px-2 py-1 rounded-badge text-brand-primary hover:underline"
                                          >
                                            <Paperclip className="w-3 h-3" /> {a.filename} {a.size ? `(${formatBytes(a.size)})` : ''}
                                          </a>
                                        ) : (
                                          <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-bg-surface border border-border-default px-2 py-1 rounded-badge text-text-secondary">
                                            <Paperclip className="w-3 h-3" /> {a.filename}
                                          </span>
                                        )
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Per-recipient breakdown */}
                                <div>
                                  <span className="text-[10px] font-heading font-semibold uppercase tracking-wider text-text-tertiary block mb-1">Recipients</span>
                                  <div className="border border-border-default rounded-input overflow-hidden">
                                    <table className="w-full text-[11px]">
                                      <tbody className="divide-y divide-border-subtle">
                                        {batch.messages.map((m) => (
                                          <tr key={m.id} className="bg-bg-surface">
                                            <td className="p-2.5">
                                              <span className="font-medium text-text-primary">{m.leadName}</span>
                                              <span className="text-text-tertiary ml-1.5">{m.leadEmail} · {m.leadCompany}</span>
                                            </td>
                                            <td className="p-2.5 text-right w-32">
                                              {m.status === 'sent' ? (
                                                <Badge variant="success">Sent</Badge>
                                              ) : (
                                                <span className="inline-flex items-center gap-1" title={m.errorDetail || 'Delivery failed'}>
                                                  <Badge variant="danger">Failed</Badge>
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  {batch.messages.some((m) => m.status === 'failed' && m.errorDetail) && (
                                    <div className="mt-1.5 space-y-0.5">
                                      {batch.messages.filter((m) => m.status === 'failed' && m.errorDetail).map((m) => (
                                        <p key={m.id} className="text-[10px] text-status-error">{m.leadName}: {m.errorDetail}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px] items-stretch">

        {/* Left Side: Threads List (1 Column) */}
        <Card className="flex flex-col h-full overflow-hidden border border-border-default">
          {/* Filters Bar */}
          <div className="p-3 border-b border-border-subtle bg-bg-canvas/50 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Inbox Threads</span>
            <label className="flex items-center space-x-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={filterPositiveOnly}
                onChange={(e) => setFilterPositiveOnly(e.target.checked)}
                className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
              />
              <span>Positive Replies Only</span>
            </label>
          </div>

          {/* List scroll */}
          <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
            {loadingThreads ? (
              <div className="flex items-center justify-center py-12 text-xs text-text-secondary">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading threads...
              </div>
            ) : (
              <>
                {filteredThreads.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedThreadId(t.id)}
                    className={`w-full text-left p-3.5 flex flex-col space-y-1.5 transition ${
                      selectedThreadId === t.id ? 'bg-brand-primary/[0.03] border-l-2 border-brand-primary' : 'hover:bg-bg-canvas/30'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-heading font-bold text-text-primary truncate max-w-[130px]">{t.senderName}</span>
                      <span className="text-[10px] text-text-tertiary tabular-nums font-heading">{t.time ? new Date(t.time).toLocaleDateString() : ''}</span>
                    </div>
                    <span className="text-[10px] font-heading font-medium text-text-secondary">{t.companyName}</span>
                    <p className="text-xs text-text-secondary truncate leading-relaxed">{t.snippet}</p>
                    <div className="pt-1">{getSentimentBadge(t.sentiment)}</div>
                  </button>
                ))}
                {filteredThreads.length === 0 && (
                  <div className="text-center py-12 text-xs text-text-secondary space-y-2 px-4">
                    <InboxIcon className="w-8 h-8 text-text-tertiary mx-auto" />
                    <span>
                      {threads.length === 0
                        ? "No reply threads yet — they'll show up here once a lead replies to one of your emails."
                        : 'No threads matched the selected filters.'}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {/* Right Side: Conversation Thread Details (2 Columns) */}
        <Card className="lg:col-span-2 flex flex-col h-full overflow-hidden border border-border-default bg-bg-canvas/10">
          {selectedThread ? (
            <div className="flex flex-col h-full justify-between">

              {/* Thread Header */}
              <div className="p-4 border-b border-border-subtle bg-bg-surface flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Avatar name={selectedThread.senderName} size="md" />
                  <div>
                    <h3 className="text-sm font-heading font-bold text-text-primary">
                      {selectedThread.senderName}{selectedThread.senderEmail ? ` (${selectedThread.senderEmail})` : ''}
                    </h3>
                    <span className="text-[11px] text-text-secondary block mt-0.5">{selectedThread.companyName}</span>
                  </div>
                </div>

                {/* Sentiment Overrides */}
                <div className="flex items-center space-x-1.5">
                  <span className="text-[10px] font-heading font-semibold text-text-tertiary uppercase">Sentiment:</span>
                  <select
                    value={selectedThread.sentiment}
                    onChange={(e) => handleUpdateSentiment(selectedThread.id, e.target.value as Sentiment)}
                    className="px-2 py-1 text-xs bg-bg-canvas border border-border-default rounded text-text-primary focus:outline-none"
                  >
                    <option value="Positive">Positive Reply</option>
                    <option value="Neutral">Neutral</option>
                    <option value="Negative">Negative</option>
                    <option value="Out-of-office">Out of Office</option>
                  </select>
                </div>
              </div>

              {/* Message History */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-bg-canvas/30">
                {selectedThread.history.map((msg, idx) => {
                  const isUser = msg.direction === 'outbound';
                  return (
                    <div key={idx} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center space-x-1.5 text-[10px] text-text-tertiary mb-1">
                        <span className="font-semibold text-text-secondary">{msg.from}</span>
                        <span>•</span>
                        <span className="tabular-nums font-heading">{msg.date}</span>
                      </div>
                      <div
                        className={`text-xs p-3.5 rounded-card border max-w-lg leading-relaxed whitespace-pre-wrap font-sans ${
                          isUser
                            ? 'bg-brand-primary text-white border-brand-primary'
                            : 'bg-bg-surface text-text-secondary border-border-default'
                        }`}
                      >
                        {msg.body}
                      </div>
                    </div>
                  );
                })}
                {selectedThread.history.length === 0 && (
                  <div className="text-center py-12 text-xs text-text-tertiary italic">No messages in this thread yet.</div>
                )}
              </div>

              {/* Reply Editor Footer */}
              <div className="p-4 border-t border-border-subtle bg-bg-surface space-y-3">
                <textarea
                  rows={3}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Compose reply to ${selectedThread.senderName}...`}
                  className="w-full text-xs p-3 bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />

                <div className="flex items-center justify-between">
                  {templates.length > 0 ? (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const tplId = e.target.value;
                        if (!tplId) return;
                        const tpl = templates.find((t) => t.id === tplId);
                        if (tpl && selectedThread) {
                          const firstName = selectedThread.senderName ? selectedThread.senderName.split(' ')[0] : 'there';
                          const resolved = tpl.body
                            .replaceAll('{{first_name}}', firstName)
                            .replaceAll('{{name}}', selectedThread.senderName || 'there')
                            .replaceAll('{{company}}', selectedThread.companyName || 'your company');
                          setReplyText(resolved);
                        }
                        e.target.value = '';
                      }}
                      className="px-2.5 py-1 text-xs bg-bg-canvas border border-border-default rounded text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    >
                      <option value="">Insert template from library...</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.type})
                        </option>
                      ))}
                    </select>
                  ) : <div />}

                  <Button
                    variant="primary"
                    size="sm"
                    loading={sendingReply}
                    disabled={!replyText.trim()}
                    onClick={handleSendReply}
                    icon={Send}
                  >
                    Send Reply
                  </Button>
                </div>
              </div>

            </div>
          ) : loadingThreads ? (
            <div className="flex items-center justify-center py-24 text-xs text-text-secondary">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading threads...
            </div>
          ) : (
            <div className="text-center py-24 text-xs text-text-secondary space-y-2">
              <MessageSquare className="w-10 h-10 text-text-tertiary mx-auto" />
              <span>
                {threads.length === 0
                  ? 'No reply threads yet — this fills up once leads start replying to your outreach.'
                  : 'Select an inbox thread from the sidebar to view conversation.'}
              </span>
            </div>
          )}
        </Card>

      </div>
      )}

      {/* Compose flow — recipient picker across every job, then the same compose/send modal used in Job Queue */}
      <LeadPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onContinue={handlePickerContinue}
      />
      <EmailComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        recipients={composeRecipients}
        onSent={handleComposeSent}
      />
    </div>
  );
};
