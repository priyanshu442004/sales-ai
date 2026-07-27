import React, { useState, useEffect } from 'react';
import { Button, Card, Badge, Avatar } from '../components/ui/core';
import {
  Mail, Linkedin, Sparkles, Eye, CheckCircle2, Loader2
} from 'lucide-react';
import { getLeads, createMessageDraft, aiRewriteMessage } from '../services/sourcingApi';
import { toast } from 'sonner';

interface ApprovedLead {
  id: string;
  company: { name: string; industry: string };
  decisionMaker: { id: string; full_name: string; designation: string; email?: string };
}

export const OutreachStudio: React.FC = () => {
  const [leads, setLeads] = useState<ApprovedLead[]>([]);
  const [selectedLead, setSelectedLead] = useState<ApprovedLead | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [sending, setSending] = useState(false);
  const [rewriting, setRewriting] = useState(false);

  // Channels
  const [channel, setChannel] = useState<'Email' | 'LinkedIn'>('Email');

  // Template inputs — {location} was dropped: nothing in the schema stores a
  // company's location, so it's not a real merge tag, only {first_name},
  // {company_name}, and {industry} are backed by genuine scraped data.
  const [subject, setSubject] = useState('Quick question regarding sales tooling at {company_name}');
  const [body, setBody] = useState(
    "Hi {first_name},\n\nI was reviewing {company_name} and saw you're active in {industry}.\n\nAre you looking at ways to automate outbound Sales AI sourcing? We've built an AI agent specifically for {industry} companies that crawls target buyers and enriches verified coordinates.\n\nWould love to show you a quick demo.\n\nBest,\n{sender_name}"
  );

  // Resolved text
  const [resolvedSubject, setResolvedSubject] = useState('');
  const [resolvedBody, setResolvedBody] = useState('');

  useEffect(() => {
    getLeads({ status: 'approved' })
      .then((res) => {
        const approvedOnly: ApprovedLead[] = res?.data || [];
        setLeads(approvedOnly);
        if (approvedOnly.length > 0) setSelectedLead(approvedOnly[0]);
      })
      .catch((e) => console.error('Failed to load approved leads:', e))
      .finally(() => setLoadingLeads(false));
  }, []);

  // Recalculate resolved template text when inputs or lead changes
  useEffect(() => {
    if (!selectedLead) {
      setResolvedSubject('');
      setResolvedBody('');
      return;
    }

    const firstName = selectedLead.decisionMaker.full_name.split(' ')[0] || 'there';
    const companyName = selectedLead.company.name;
    const industry = selectedLead.company.industry || 'your industry';

    const replaceTags = (text: string) =>
      text
        .replace(/{first_name}/g, firstName)
        .replace(/{company_name}/g, companyName)
        .replace(/{industry}/g, industry)
        .replace(/{sender_name}/g, 'the team');

    setResolvedSubject(replaceTags(subject));
    setResolvedBody(replaceTags(body));
  }, [subject, body, selectedLead]);

  const handleInsertTag = (tag: string) => {
    setBody((prev) => prev + ` ${tag}`);
  };

  const handleGenerateAiAlternative = async () => {
    setRewriting(true);
    try {
      const result = await aiRewriteMessage({
        subject: channel === 'Email' ? subject : undefined,
        body,
      });
      if (result.subject) setSubject(result.subject);
      setBody(result.body);
      toast.success('AI template alternative generated!');
    } catch (e: any) {
      toast.error(e.message || 'AI rewrite failed — is ANTHROPIC_API_KEY configured?');
    } finally {
      setRewriting(false);
    }
  };

  const handleSaveToQueue = async () => {
    if (!selectedLead) return;
    setSending(true);
    try {
      await createMessageDraft({
        leadId: selectedLead.id,
        type: channel === 'Email' ? 'Cold Email' : 'LinkedIn Connection Note',
        subject: channel === 'Email' ? resolvedSubject : undefined,
        body: resolvedBody,
      });
      toast.success(`Message for ${selectedLead.decisionMaker.full_name} added to the Approval Queue!`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Outreach Studio</h1>
          <p className="text-xs text-text-secondary mt-1">Compose message templates, insert dynamic buyer tokens, and review resolved previews.</p>
        </div>
      </div>

      {/* Editor & Preview Split Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left Side: Template Editor */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border-subtle pb-3">
            <h3 className="text-sm font-heading font-bold text-text-primary">Outreach Composer</h3>
            <div className="flex bg-bg-canvas p-1 rounded-btn border border-border-subtle space-x-1">
              <button
                onClick={() => setChannel('Email')}
                className={`flex items-center space-x-1.5 px-3 py-1 text-xs font-heading font-semibold rounded-btn transition ${
                  channel === 'Email' ? 'bg-bg-surface text-brand-primary border border-border-default' : 'text-text-secondary'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Cold Email</span>
              </button>
              <button
                onClick={() => setChannel('LinkedIn')}
                className={`flex items-center space-x-1.5 px-3 py-1 text-xs font-heading font-semibold rounded-btn transition ${
                  channel === 'LinkedIn' ? 'bg-bg-surface text-brand-primary border border-border-default' : 'text-text-secondary'
                }`}
              >
                <Linkedin className="w-3.5 h-3.5" />
                <span>LinkedIn DM</span>
              </button>
            </div>
          </div>

          {/* Dynamic merge tags */}
          <div className="space-y-1.5">
            <span className="block text-xs font-heading font-semibold text-text-secondary">Insert Dynamic Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {['{first_name}', '{company_name}', '{industry}'].map(tag => (
                <button
                  key={tag}
                  onClick={() => handleInsertTag(tag)}
                  className="text-xs bg-bg-canvas hover:bg-border-subtle border border-border-default px-2.5 py-1 rounded text-text-secondary font-mono"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {channel === 'Email' && (
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Email Subject Line</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Message Body</label>
              <textarea
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="p-3 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary leading-relaxed font-sans"
              />
            </div>
          </div>

          {/* AI Helper buttons */}
          <div className="flex justify-between items-center pt-3 border-t border-border-subtle">
            <Button
              variant="outline"
              size="sm"
              icon={rewriting ? Loader2 : Sparkles}
              onClick={handleGenerateAiAlternative}
              disabled={rewriting}
            >
              {rewriting ? 'Rewriting...' : 'AI Rewrite Template'}
            </Button>
          </div>
        </Card>

        {/* Right Side: Lead Resolver & Live Preview */}
        <div className="space-y-4">

          {/* Select Lead preview picker */}
          <Card className="p-4 flex items-center justify-between border border-border-default">
            <div>
              <span className="block text-xs font-heading font-semibold text-text-secondary">Preview Target Lead</span>
              {loadingLeads ? (
                <span className="text-xs text-text-tertiary italic">Loading approved leads...</span>
              ) : selectedLead ? (
                <span className="text-sm font-heading font-bold text-text-primary mt-1 block">
                  {selectedLead.decisionMaker.full_name} ({selectedLead.company.name})
                </span>
              ) : (
                <span className="text-xs text-text-tertiary italic">No approved leads found — approve a lead first.</span>
              )}
            </div>
            {leads.length > 0 && (
              <select
                value={selectedLead?.id || ''}
                onChange={(e) => {
                  const lead = leads.find(l => l.id === e.target.value);
                  if (lead) setSelectedLead(lead);
                }}
                className="px-2 py-1.5 text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
              >
                {leads.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.company.name} · {l.decisionMaker.full_name}
                  </option>
                ))}
              </select>
            )}
          </Card>

          {/* Resolved output preview device */}
          {selectedLead && (
            <Card className="p-5 bg-bg-canvas/30 border border-border-default relative overflow-hidden flex flex-col justify-between min-h-[380px]">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-border-subtle mb-4">
                  <div className="flex items-center space-x-2">
                    <Eye className="w-4 h-4 text-text-secondary" />
                    <span className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Live Preview Device</span>
                  </div>
                  <Badge variant={channel === 'Email' ? 'neutral' : 'info'}>
                    {channel === 'Email' ? 'Email Client' : 'LinkedIn Messenger'}
                  </Badge>
                </div>

                <div className="bg-bg-surface border border-border-subtle rounded-card shadow-sm p-4 space-y-3">
                  <div className="flex items-center space-x-3 pb-3 border-b border-border-subtle text-xs">
                    <Avatar name={selectedLead.decisionMaker.full_name} size="sm" />
                    <div>
                      <div className="text-text-primary font-medium">
                        To: {selectedLead.decisionMaker.full_name} ({selectedLead.decisionMaker.email || 'no email on file'})
                      </div>
                    </div>
                  </div>

                  {channel === 'Email' && (
                    <div className="text-xs font-heading font-semibold text-text-primary bg-bg-canvas px-2.5 py-1.5 rounded border border-border-subtle">
                      Subject: {resolvedSubject}
                    </div>
                  )}

                  <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap font-sans">
                    {resolvedBody}
                  </div>
                </div>
              </div>

              {/* Approve & Add to Queue Actions */}
              <div className="mt-6 pt-4 border-t border-border-subtle flex justify-end space-x-2">
                <Button
                  variant="primary"
                  onClick={handleSaveToQueue}
                  icon={sending ? Loader2 : CheckCircle2}
                  disabled={sending || !selectedLead.decisionMaker.email}
                  title={!selectedLead.decisionMaker.email ? 'This lead has no email on file' : undefined}
                >
                  {sending ? 'Sending...' : 'Send to Approval Queue'}
                </Button>
              </div>
            </Card>
          )}

        </div>

      </div>
    </div>
  );
};
