import React, { useState } from 'react';
import { Card, Button, Badge } from '../components/ui/core';
import { Key, Building, Webhook, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { changePassword } from '../services/sourcingApi';

export const Settings: React.FC = () => {
  const [companyName, setCompanyName] = useState('Acme Corp');
  const [smtpSender, setSmtpSender] = useState('priya@acme.co');
  const [webhookUrl, setWebhookUrl] = useState('https://api.acme.co/webhooks/sales-ai');
  const [mfaEnabled, setMfaEnabled] = useState(true);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleSaveSettings = () => {
    toast.success('Workspace configurations successfully saved.');
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      toast.error('Please fill in both password fields.');
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('Password successfully updated.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update password.');
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Workspace Settings</h1>
          <p className="text-xs text-text-secondary mt-1">Configure profile details, security access, sending domains and system webhook event updates.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Columns Settings Form */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Workspace Details */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-border-subtle">
              <Building className="w-5 h-5 text-brand-primary" />
              <h3 className="text-sm font-heading font-bold text-text-primary">Workspace Profile Details</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Default SMTP Sender Address</label>
                <input
                  type="email"
                  value={smtpSender}
                  onChange={(e) => setSmtpSender(e.target.value)}
                  className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
                />
              </div>
            </div>
          </Card>

          {/* Webhook notification routing */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-border-subtle">
              <Webhook className="w-5 h-5 text-brand-primary" />
              <h3 className="text-sm font-heading font-bold text-text-primary">Webhooks & Event Listeners</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Destination Webhook URL</label>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-2 pt-2 text-xs text-text-secondary">
                <span className="font-heading font-semibold text-text-primary block">Trigger events</span>
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-border-default text-brand-primary mr-2" />
                  <span>Crawl job completed successfully</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-border-default text-brand-primary mr-2" />
                  <span>Outbox send approved by teammate</span>
                </label>
              </div>
            </div>
          </Card>

          {/* Save trigger */}
          <div className="flex justify-end">
            <Button variant="primary" onClick={handleSaveSettings}>
              Save All Settings
            </Button>
          </div>

        </div>

        {/* Right side: Security & authentication */}
        <div className="space-y-6">
          <Card className="p-5 space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-border-subtle">
              <Key className="w-5 h-5 text-brand-primary" />
              <h3 className="text-sm font-heading font-bold text-text-primary">Security & SSO</h3>
            </div>

            <div className="space-y-3 text-xs text-text-secondary">
              <div className="flex justify-between items-center">
                <span>Multi-Factor Authentication (MFA)</span>
                <button
                  onClick={() => {
                    setMfaEnabled(!mfaEnabled);
                    toast.info(mfaEnabled ? 'MFA disabled' : 'MFA enforced.');
                  }}
                  className={`w-10 h-5 rounded-full relative transition-colors ${mfaEnabled ? 'bg-brand-primary' : 'bg-border-default'}`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.8 transition-all ${mfaEnabled ? 'right-0.8' : 'left-0.8'}`} />
                </button>
              </div>
              
              <div className="border-t border-border-subtle pt-3 space-y-2">
                <span className="font-heading font-semibold text-text-primary block">Domain Verification Status</span>
                <div className="flex justify-between items-center p-2 bg-bg-canvas rounded border border-border-subtle">
                  <span>acme.co (SPF/DKIM)</span>
                  <Badge variant="success">Verified</Badge>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-border-subtle">
              <Key className="w-5 h-5 text-brand-primary" />
              <h3 className="text-sm font-heading font-bold text-text-primary">Change Password</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
                />
              </div>

              <Button
                variant="outline"
                onClick={handleChangePassword}
                className="w-full text-xs font-semibold"
              >
                Update Password
              </Button>
            </div>
          </Card>

          <Card className="p-5 bg-bg-canvas/50 border border-border-subtle flex items-start space-x-3">
            <ShieldAlert className="w-5 h-5 text-brand-primary shrink-0" />
            <div className="text-xs text-text-secondary">
              <span className="font-heading font-semibold text-text-primary block">Billing details</span>
              Enterprise workspace: active. next invoice due in 14 days. Limit: 2,500 credits/mo.
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
};
