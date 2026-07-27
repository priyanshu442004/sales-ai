import React, { useState } from 'react';
import { Card, Button, Badge, Modal } from '../components/ui/core';
import { Key, Link2, Unlink } from 'lucide-react';
import { toast } from 'sonner';

interface IntegrationCard {
  id: string;
  name: string;
  category: 'CRM' | 'Outbound' | 'Sourcing';
  logo: string;
  description: string;
  connected: boolean;
}

export const Integrations: React.FC = () => {
  const [integrations, setIntegrations] = useState<IntegrationCard[]>([
    { id: 'salesforce', name: 'Salesforce CRM', category: 'CRM', logo: '☁️', description: 'Log approved leads and outreach histories directly to target CRM contacts.', connected: true },
    { id: 'hubspot', name: 'HubSpot', category: 'CRM', logo: '🧡', description: 'Synchronize Sales AI records, logs, and deal flows.', connected: false },
    { id: 'apollo', name: 'Apollo.io Sourcing', category: 'Sourcing', logo: '🚀', description: 'Source verified contact emails and locations.', connected: true },
    { id: 'proxycurl', name: 'Proxycurl (LinkedIn)', category: 'Sourcing', logo: '🔗', description: 'Crawl LinkedIn profile URLs and social activity histories.', connected: false },
    { id: 'google_smtp', name: 'Google SMTP', category: 'Outbound', logo: '📧', description: 'Send high-deliverability cold outreach from custom domains.', connected: true },
    { id: 'unipile', name: 'Unipile (LinkedIn API)', category: 'Outbound', logo: '💬', description: 'Deliver automated direct messages and connection prompts.', connected: false }
  ]);

  const [activeModal, setActiveModal] = useState<IntegrationCard | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState('');

  const handleOpenConnect = (intg: IntegrationCard) => {
    setActiveModal(intg);
    setApiKey('');
    setClientId('');
  };

  const handleConnectSubmit = () => {
    if (!activeModal) return;
    
    // Toggle state
    setIntegrations(prev => prev.map(i => i.id === activeModal.id ? { ...i, connected: true } : i));
    toast.success(`Successfully connected ${activeModal.name}!`);
    setActiveModal(null);
  };

  const handleDisconnect = (id: string, name: string) => {
    setIntegrations(prev => prev.map(i => i.id === id ? { ...i, connected: false } : i));
    toast.warning(`Disconnected ${name}`);
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Integrations & Credentials</h1>
          <p className="text-xs text-text-secondary mt-1">Connect CRM tools, database provider keys, and outbound mail routing channels.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map(intg => (
          <Card key={intg.id} className="p-5 flex flex-col justify-between space-y-4 border border-border-default hover:shadow-md transition">
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded bg-bg-canvas flex items-center justify-center text-lg border border-border-subtle">
                    {intg.logo}
                  </div>
                  <div>
                    <span className="text-sm font-heading font-bold text-text-primary block">{intg.name}</span>
                    <span className="text-[10px] text-text-tertiary font-heading font-semibold uppercase">{intg.category}</span>
                  </div>
                </div>

                <Badge variant={intg.connected ? 'success' : 'neutral'}>
                  {intg.connected ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>

              <p className="text-xs text-text-secondary leading-relaxed">
                {intg.description}
              </p>
            </div>

            <div className="border-t border-border-subtle pt-3.5 flex justify-end">
              {intg.connected ? (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs text-status-danger hover:bg-status-danger-bg hover:border-status-danger/25"
                  onClick={() => handleDisconnect(intg.id, intg.name)}
                >
                  <Unlink className="w-3.5 h-3.5 mr-1" /> Disconnect
                </Button>
              ) : (
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="text-xs text-brand-primary"
                  onClick={() => handleOpenConnect(intg)}
                >
                  <Link2 className="w-3.5 h-3.5 mr-1" /> Connect API
                </Button>
              )}
            </div>

          </Card>
        ))}
      </div>

      {/* Connect API Credentials Modal */}
      <Modal
        isOpen={activeModal !== null}
        onClose={() => setActiveModal(null)}
        title={activeModal ? `Connect ${activeModal.name}` : ''}
        size="md"
      >
        {activeModal && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2.5 text-xs text-text-secondary bg-bg-canvas p-3 rounded-card border border-border-subtle">
              <Key className="w-4.5 h-4.5 text-brand-primary" />
              <span>Input mock credentials keys below to link workspace channel.</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">API Key / Token</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_live_••••••••••••"
                  className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
                />
              </div>

              {activeModal.category === 'CRM' && (
                <div>
                  <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Client ID / URL</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="https://company.my.salesforce.com"
                    className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 border-t border-border-subtle pt-3.5">
              <Button variant="secondary" size="sm" onClick={() => setActiveModal(null)}>Cancel</Button>
              <Button 
                variant="primary" 
                size="sm" 
                disabled={!apiKey}
                onClick={handleConnectSubmit}
              >
                Validate & Connect
              </Button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
};
