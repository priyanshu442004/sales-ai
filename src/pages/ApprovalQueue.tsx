import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, Badge, Modal } from '../components/ui/core';
import {
  Check, Edit3, Mail, Linkedin, Trash2, Send,
  ShieldCheck, CheckSquare, Loader2
} from 'lucide-react';
import {
  getMessages, approveMessage, rejectMessage, sendApprovedMessage,
  updateMessageDraft, bulkApproveMessages,
} from '../services/sourcingApi';
import { toast } from 'sonner';

interface MessageDraft {
  id: string;
  leadId: string;
  leadName: string;
  leadDesignation: string;
  leadCompany: string;
  leadEmail: string | null;
  score: number | null;
  sourceJobName: string;
  type: string;
  channel: 'email' | 'linkedin';
  subject: string | null;
  body: string;
  status: string;
  createdAt: string;
}

export const ApprovalQueue: React.FC = () => {
  const [drafts, setDrafts] = useState<MessageDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  // Edit Draft inline Modal state
  const [editingDraft, setEditingDraft] = useState<MessageDraft | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editSubject, setEditSubject] = useState('');

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await getMessages({ status: 'pending_approval' });
      setDrafts(res?.data || []);
    } catch (e: any) {
      console.error('Failed to load pending messages:', e.message);
      toast.error('Failed to load pending messages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const setWorking = (id: string, working: boolean) => {
    setWorkingIds((prev) => {
      const next = new Set(prev);
      if (working) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleApproveDraft = async (draftId: string) => {
    setWorking(draftId, true);
    try {
      await approveMessage(draftId);
      const result = await sendApprovedMessage(draftId);
      if (result.status === 'sent') {
        toast.success('Message sent successfully.');
      } else {
        toast.error(result.errorDetail || 'Message approved but failed to send.');
      }
      setSelectedIds((prev) => prev.filter((id) => id !== draftId));
      fetchDrafts();
    } catch (e: any) {
      toast.error(e.message || 'Failed to approve/send message.');
    } finally {
      setWorking(draftId, false);
    }
  };

  const handleDiscardDraft = async (draftId: string) => {
    setWorking(draftId, true);
    try {
      await rejectMessage(draftId);
      toast.warning('Draft discarded.');
      setSelectedIds((prev) => prev.filter((id) => id !== draftId));
      fetchDrafts();
    } catch (e: any) {
      toast.error(e.message || 'Failed to discard draft.');
    } finally {
      setWorking(draftId, false);
    }
  };

  const handleEditDraft = (draft: MessageDraft) => {
    setEditingDraft(draft);
    setEditBody(draft.body);
    setEditSubject(draft.subject || '');
  };

  const handleSaveEdit = async () => {
    if (!editingDraft) return;
    try {
      await updateMessageDraft(editingDraft.id, {
        subject: editingDraft.channel === 'email' ? editSubject : undefined,
        body: editBody,
      });
      toast.success('Message draft updated successfully.');
      setEditingDraft(null);
      fetchDrafts();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save changes.');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? drafts.map((d) => d.id) : []);
  };

  const handleSelectRow = (draftId: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, draftId] : prev.filter((id) => id !== draftId)));
  };

  const handleBulkApprove = async () => {
    setBulkWorking(true);
    try {
      await bulkApproveMessages(selectedIds);
      const results = await Promise.allSettled(selectedIds.map((id) => sendApprovedMessage(id)));
      const sent = results.filter((r) => r.status === 'fulfilled' && (r.value as any).status === 'sent').length;
      const failed = selectedIds.length - sent;
      if (failed === 0) toast.success(`Sent ${sent} message(s).`);
      else toast.error(`Sent ${sent}, ${failed} failed.`);
      setSelectedIds([]);
      fetchDrafts();
    } catch (e: any) {
      toast.error(e.message || 'Bulk approve failed.');
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkDiscard = async () => {
    setBulkWorking(true);
    try {
      const results = await Promise.allSettled(selectedIds.map((id) => rejectMessage(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) toast.error(`${failed} draft(s) failed to discard.`);
      toast.warning(`Discarded ${selectedIds.length - failed} draft(s).`);
      setSelectedIds([]);
      fetchDrafts();
    } finally {
      setBulkWorking(false);
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Outbound Send Approvals</h1>
          <p className="text-xs text-text-secondary mt-1">Review, edit, and approve individual message drafts before dispatching.</p>
        </div>
        <div className="flex items-center space-x-3 bg-status-danger-bg px-3 py-1.5 rounded-btn border border-status-danger/25 text-status-danger font-heading font-bold text-xs">
          <ShieldCheck className="w-4 h-4 text-status-danger mr-1" />
          <span>{drafts.length} Messages Pending Approval</span>
        </div>
      </div>

      {/* Bulk Action Controls */}
      {drafts.length > 0 && (
        <div className="flex items-center justify-between bg-bg-canvas p-3 rounded-card border border-border-subtle text-xs">
          <label className="flex items-center space-x-2 cursor-pointer font-heading font-semibold text-text-secondary">
            <input
              type="checkbox"
              checked={selectedIds.length === drafts.length && drafts.length > 0}
              onChange={(e) => handleSelectAll(e.target.checked)}
              className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
            />
            <span>Select All Pending ({drafts.length})</span>
          </label>

          {selectedIds.length > 0 && (
            <div className="flex items-center space-x-2 animate-in fade-in slide-in-from-right-2 duration-150">
              <span className="text-text-tertiary mr-2 font-heading font-semibold text-[11px] uppercase tracking-wide">
                {selectedIds.length} Selected
              </span>
              <Button variant="outline" size="sm" className="text-xs text-status-danger" onClick={handleBulkDiscard} disabled={bulkWorking}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Discard
              </Button>
              <Button variant="primary" size="sm" className="text-xs" onClick={handleBulkApprove} disabled={bulkWorking}>
                <Send className="w-3.5 h-3.5 mr-1" /> Approve & Send Outbound
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Grid List of Drafts */}
      {loading ? (
        <Card className="py-16 text-center">
          <Loader2 className="w-8 h-8 text-text-tertiary mx-auto animate-spin" />
        </Card>
      ) : drafts.length === 0 ? (
        <Card className="py-16 text-center space-y-3">
          <CheckSquare className="w-10 h-10 text-status-success mx-auto" />
          <h3 className="text-sm font-heading font-bold text-text-primary">Outbox is clear</h3>
          <p className="text-xs text-text-secondary max-w-sm mx-auto">
            All generated outbound templates have been processed. Head to the Outreach Studio to compose new sequences.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {drafts.map((draft) => {
            const isSelected = selectedIds.includes(draft.id);
            const isWorking = workingIds.has(draft.id);

            return (
              <Card
                key={draft.id}
                className={`p-5 transition hover:shadow border ${
                  isSelected ? 'border-brand-primary bg-brand-primary/[0.01]' : 'border-border-default'
                }`}
              >
                <div className="flex items-start space-x-3.5">
                  {/* Row Checkbox Selector */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => handleSelectRow(draft.id, e.target.checked)}
                    className="rounded border-border-default text-brand-primary focus:ring-brand-primary mt-1"
                  />

                  {/* Message Card content */}
                  <div className="flex-1 space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded bg-brand-primary/10 text-brand-primary flex items-center justify-center font-heading font-bold text-xs shrink-0">
                          {(draft.leadCompany || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-heading font-bold text-text-primary">
                              {draft.leadName}
                            </span>
                            <span className="text-xs text-text-tertiary">
                              ({draft.leadDesignation} at {draft.leadCompany})
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 text-[10px] text-text-secondary mt-0.5">
                            {draft.score !== null && (
                              <>
                                <span className="bg-bg-canvas px-1.5 py-0.5 rounded border border-border-subtle font-heading">
                                  Score: {draft.score} Fit
                                </span>
                                <span>•</span>
                              </>
                            )}
                            <span className="font-heading">Crawl Source: {draft.sourceJobName}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Badge variant={draft.channel === 'email' ? 'neutral' : 'info'}>
                          {draft.channel === 'email' ? (
                            <span className="flex items-center"><Mail className="w-3.5 h-3.5 mr-1" /> Email</span>
                          ) : (
                            <span className="flex items-center"><Linkedin className="w-3.5 h-3.5 mr-1" /> LinkedIn DM</span>
                          )}
                        </Badge>
                      </div>
                    </div>

                    {/* Email Subject block */}
                    {draft.channel === 'email' && draft.subject && (
                      <div className="text-xs font-heading font-semibold text-text-primary bg-bg-canvas px-3 py-2 rounded border border-border-subtle font-mono">
                        Subject: {draft.subject}
                      </div>
                    )}

                    {!draft.leadEmail && draft.channel === 'email' && (
                      <div className="text-[11px] text-status-danger italic">
                        No email address on file for this lead — sending will fail until one is found.
                      </div>
                    )}

                    {/* Message Body */}
                    <div className="text-xs text-text-secondary leading-relaxed bg-bg-canvas/40 p-4 rounded-card border border-border-subtle whitespace-pre-wrap font-sans">
                      {draft.body}
                    </div>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                      <span className="text-[10px] text-text-tertiary font-heading">
                        Generated {new Date(draft.createdAt).toLocaleTimeString()}
                      </span>
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-status-danger px-2.5 h-8 hover:bg-status-danger-bg"
                          onClick={() => handleDiscardDraft(draft.id)}
                          disabled={isWorking}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Discard
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="text-xs px-2.5 h-8"
                          onClick={() => handleEditDraft(draft)}
                          disabled={isWorking}
                        >
                          <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit Copy
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          className="text-xs px-3.5 h-8"
                          onClick={() => handleApproveDraft(draft.id)}
                          disabled={isWorking}
                        >
                          {isWorking ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />} Approve & Send
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit draft modal */}
      <Modal
        isOpen={editingDraft !== null}
        onClose={() => setEditingDraft(null)}
        title="Edit Outreach Message Copy"
        size="md"
      >
        {editingDraft && (
          <div className="space-y-4">
            {editingDraft.channel === 'email' && (
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Subject</label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Message Body</label>
              <textarea
                rows={8}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="p-3 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none leading-relaxed"
              />
            </div>

            <div className="flex justify-end space-x-2 border-t border-border-subtle pt-3">
              <Button variant="secondary" size="sm" onClick={() => setEditingDraft(null)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSaveEdit}>Apply Changes</Button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
};
