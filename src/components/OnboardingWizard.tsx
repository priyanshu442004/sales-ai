import React, { useState } from 'react';
import { toast } from 'sonner';
import { useUiStore } from '../store/useUiStore';
import { Modal, Button, Avatar } from './ui/core';
import { Building2, Key, Users, Check, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';
import { inviteTeammates } from '../services/sourcingApi';

export const OnboardingWizard: React.FC = () => {
  const { onboardingStep, setOnboardingStep } = useUiStore();
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('SaaS');
  const [senderIdentity, setSenderIdentity] = useState('');
  const [logoFile, setLogoFile] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const [connectedSources, setConnectedSources] = useState<Record<string, boolean>>({
    apollo: true,
    proxycurl: false,
    smtp: true,
    unipile: false,
  });

  const [teammateEmails, setTeammateEmails] = useState<{ email: string; role: string }[]>([
    { email: '', role: 'Sales Rep' }
  ]);

  if (onboardingStep === null) return null;

  // A real random password, not a placeholder — sent to each invitee by
  // email exactly the way Team.tsx's own invite flow already does, since
  // this wizard step calls the same real POST /team endpoint.
  const generatePassword = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  };

  const handleNext = async () => {
    if (onboardingStep < 3) {
      setOnboardingStep(onboardingStep + 1);
      return;
    }

    const rows = teammateEmails.filter((t) => t.email.trim());
    if (rows.length === 0) {
      setOnboardingStep(null);
      return;
    }

    setFinishing(true);
    try {
      const res = await inviteTeammates(
        rows.map((r) => ({ email: r.email.trim(), role: r.role, password: generatePassword() }))
      );
      const failed = res.results.filter((r) => !r.success);
      if (res.invited > 0) {
        toast.success(`Invited ${res.invited} of ${res.total} teammate${res.total > 1 ? 's' : ''}.`);
      }
      failed.forEach((r) => toast.error(`${r.email}: ${r.error}`));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send invites.');
    } finally {
      setFinishing(false);
      setOnboardingStep(null);
    }
  };

  const handleBack = () => {
    if (onboardingStep > 1) {
      setOnboardingStep(onboardingStep - 1);
    }
  };

  const toggleSource = (key: string) => {
    setConnectedSources(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAddTeammate = () => {
    setTeammateEmails(prev => [...prev, { email: '', role: 'Sales Rep' }]);
  };

  const handleUpdateTeammate = (idx: number, field: 'email' | 'role', val: string) => {
    setTeammateEmails(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  return (
    <Modal
      isOpen={onboardingStep !== null}
      onClose={() => setOnboardingStep(null)}
      title={`Set up Workspace — Step ${onboardingStep} of 3`}
      size="md"
    >
      <div className="space-y-6">
        {/* Step Indicator Header */}
        <div className="flex items-center justify-between border-b border-border-subtle pb-4">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-heading font-semibold ${onboardingStep >= 1 ? 'bg-brand-primary text-white' : 'bg-bg-canvas text-text-tertiary'}`}>
                1
              </div>
              <span className={`text-xs font-heading font-medium ${onboardingStep === 1 ? 'text-text-primary' : 'text-text-secondary'}`}>Profile</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-heading font-semibold ${onboardingStep >= 2 ? 'bg-brand-primary text-white' : 'bg-bg-canvas text-text-tertiary'}`}>
                2
              </div>
              <span className={`text-xs font-heading font-medium ${onboardingStep === 2 ? 'text-text-primary' : 'text-text-secondary'}`}>Integrations</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-heading font-semibold ${onboardingStep >= 3 ? 'bg-brand-primary text-white' : 'bg-bg-canvas text-text-tertiary'}`}>
                3
              </div>
              <span className={`text-xs font-heading font-medium ${onboardingStep === 3 ? 'text-text-primary' : 'text-text-secondary'}`}>Team</span>
            </div>
          </div>
          <button
            onClick={() => setOnboardingStep(null)}
            className="text-xs text-text-tertiary hover:text-text-primary font-heading font-medium"
          >
            Skip Wizard
          </button>
        </div>

        {/* Step 1: Company Profile */}
        {onboardingStep === 1 && (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 bg-bg-canvas p-4 rounded-card border border-border-subtle">
              <Building2 className="w-8 h-8 text-brand-primary shrink-0" />
              <div>
                <h4 className="text-sm font-heading font-semibold text-text-primary">Workspace Profile</h4>
                <p className="text-xs text-text-secondary">Define default sender details and branding for outbound emails.</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="px-3 py-2 w-full text-sm bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Industry</label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="px-3 py-2 w-full text-sm bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  >
                    <option value="SaaS">SaaS & Software</option>
                    <option value="AI & Robotics">AI & Robotics</option>
                    <option value="HealthTech">HealthTech</option>
                    <option value="Fintech">Fintech</option>
                    <option value="Clean Energy">Clean Energy</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Default Sender Email</label>
                  <input
                    type="email"
                    value={senderIdentity}
                    onChange={(e) => setSenderIdentity(e.target.value)}
                    className="px-3 py-2 w-full text-sm bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Workspace Logo URL</label>
                <div className="flex items-center space-x-3">
                  <Avatar name={companyName} src={logoFile || ''} size="md" />
                  <input
                    type="text"
                    placeholder="https://example.com/logo.png"
                    value={logoFile || ''}
                    onChange={(e) => setLogoFile(e.target.value || null)}
                    className="px-3 py-2 flex-1 text-sm bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Integrations */}
        {onboardingStep === 2 && (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 bg-bg-canvas p-4 rounded-card border border-border-subtle">
              <Key className="w-8 h-8 text-brand-primary shrink-0" />
              <div>
                <h4 className="text-sm font-heading font-semibold text-text-primary">Connect Data & Outbound channels</h4>
                <p className="text-xs text-text-secondary">Integrate data crawling and outbound providers to fetch contacts.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'apollo', name: 'Apollo.io', desc: 'Sourcing emails', type: 'Database' },
                { key: 'proxycurl', name: 'Proxycurl API', desc: 'LinkedIn Crawler', type: 'Enrichment' },
                { key: 'smtp', name: 'SMTP Sending', desc: 'Direct outbound mail', type: 'Outbound' },
                { key: 'unipile', name: 'Unipile (LinkedIn)', desc: 'Direct Messages', type: 'Outbound' }
              ].map((src) => (
                <div key={src.key} className="border border-border-default rounded-card p-3 flex flex-col justify-between space-y-2 bg-bg-surface hover:border-border-default transition">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-heading font-semibold text-text-primary">{src.name}</span>
                      <span className="text-[9px] bg-bg-canvas text-text-secondary px-1 py-0.5 rounded border border-border-subtle uppercase font-heading">{src.type}</span>
                    </div>
                    <p className="text-[11px] text-text-secondary mt-1">{src.desc}</p>
                  </div>
                  <Button
                    variant={connectedSources[src.key] ? 'outline' : 'secondary'}
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => toggleSource(src.key)}
                  >
                    {connectedSources[src.key] ? (
                      <span className="flex items-center text-status-success">
                        <Check className="w-3.5 h-3.5 mr-1" /> Connected
                      </span>
                    ) : 'Connect Source'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Invite Team */}
        {onboardingStep === 3 && (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 bg-bg-canvas p-4 rounded-card border border-border-subtle">
              <Users className="w-8 h-8 text-brand-primary shrink-0" />
              <div>
                <h4 className="text-sm font-heading font-semibold text-text-primary">Invite Teammates</h4>
                <p className="text-xs text-text-secondary">Add coworkers to delegate validation checks and outbound campaigns.</p>
              </div>
            </div>

            <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
              {teammateEmails.map((item, idx) => (
                <div key={idx} className="flex items-center space-x-3">
                  <input
                    type="email"
                    placeholder="teammate@company.com"
                    value={item.email}
                    onChange={(e) => handleUpdateTeammate(idx, 'email', e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  />
                  <select
                    value={item.role}
                    onChange={(e) => handleUpdateTeammate(idx, 'role', e.target.value)}
                    className="px-3 py-1.5 text-sm bg-bg-surface border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary w-32"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Sales Manager">Sales Manager</option>
                    <option value="Sales Rep">Sales Rep</option>
                    <option value="Reviewer-only">Reviewer-only</option>
                  </select>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="text-xs px-2 h-7" onClick={handleAddTeammate}>
                + Add email row
              </Button>
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex items-center justify-between border-t border-border-subtle pt-4 mt-6">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBack}
            disabled={onboardingStep === 1}
            icon={ArrowLeft}
          >
            Back
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleNext}
            disabled={finishing}
          >
            {onboardingStep === 3 ? (
              <span className="flex items-center">
                {finishing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                {finishing ? 'Sending invites...' : 'Finish Setup'}
                {!finishing && <Check className="w-4 h-4 ml-1.5" />}
              </span>
            ) : (
              <span className="flex items-center">
                Continue <ArrowRight className="w-4 h-4 ml-1.5" />
              </span>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
