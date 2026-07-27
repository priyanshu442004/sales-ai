import React, { useState } from 'react';
import { Button, Card, Badge } from '../components/ui/core';
import { 
  LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { 
  Play, Pause, Plus, MoreVertical, Users, ArrowLeft, Mail, Linkedin,
  CheckCircle2, XCircle, AlertCircle, HelpCircle
} from 'lucide-react';
import { dbCampaigns } from '../mocks/mockData';
import type { Campaign } from '../types/api';
import { toast } from 'sonner';

export const Campaigns: React.FC = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>(dbCampaigns);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);

  const toggleCampaignStatus = (campaignId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Stop navigation to detail
    const updated = campaigns.map((c): Campaign => {
      if (c.id === campaignId) {
        const nextStatus: Campaign['status'] = c.status === 'Active' ? 'Paused' : 'Active';
        toast.info(`Campaign ${c.name} is now ${nextStatus}`);
        return { ...c, status: nextStatus };
      }
      return c;
    });
    setCampaigns(updated);
  };

  const getStatusBadge = (status: Campaign['status']) => {
    switch (status) {
      case 'Active':
        return <Badge variant="success">Active</Badge>;
      case 'Paused':
        return <Badge variant="warning">Paused</Badge>;
      case 'Draft':
        return <Badge variant="neutral">Draft</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  // Mock campaign detail time-series metrics
  const detailTimeSeriesData = [
    { day: 'Day 1', sent: 10, opened: 6, replied: 1 },
    { day: 'Day 2', sent: 25, opened: 16, replied: 3 },
    { day: 'Day 3', sent: 48, opened: 32, replied: 8 },
    { day: 'Day 4', sent: 62, opened: 45, replied: 12 },
    { day: 'Day 5', sent: 80, opened: 56, replied: 18 }
  ];

  // Mock channel mix for donut chart
  const channelMixData = [
    { name: 'Email Outreach', value: 65, color: 'var(--brand-primary)' },
    { name: 'LinkedIn Messages', value: 35, color: '#C8863A' }
  ];

  // Mock recipient status data
  const mockRecipients = [
    { email: 'john@nimbusrobotics.ai', name: 'John Chen', channel: 'Email', status: 'Booked', date: 'Jul 15, 2026' },
    { email: 'sarah.p@healthtech.com', name: 'Sarah Patel', channel: 'LinkedIn', status: 'Replied', date: 'Jul 14, 2026' },
    { email: 'elena@centurafinancial.com', name: 'Elena Rodriguez', channel: 'Email', status: 'Opened', date: 'Jul 14, 2026' },
    { email: 'david.oc@greengrid.io', name: 'David O\'Connor', channel: 'Email', status: 'Sent', date: 'Jul 13, 2026' },
    { email: 'marcus@aetherlogistics.com', name: 'Marcus Taylor', channel: 'LinkedIn', status: 'Bounced', date: 'Jul 12, 2026' }
  ];

  const getRecipientStatusIcon = (status: string) => {
    switch (status) {
      case 'Booked':
        return <CheckCircle2 className="w-4 h-4 text-status-success" />;
      case 'Replied':
        return <CheckCircle2 className="w-4 h-4 text-brand-accent" />;
      case 'Opened':
        return <HelpCircle className="w-4 h-4 text-status-info" />;
      case 'Bounced':
        return <XCircle className="w-4 h-4 text-status-danger" />;
      default:
        return <AlertCircle className="w-4 h-4 text-text-tertiary" />;
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {!selectedCampaign ? (
        // Master view: list of campaigns
        <>
          {/* Page Header */}
          <div className="flex items-center justify-between border-b border-border-subtle pb-4">
            <div>
              <h1 className="text-2xl font-heading font-bold text-text-primary">Outreach Campaigns</h1>
              <p className="text-xs text-text-secondary mt-1">Monitor, adjust, and review performance indicators of outbound outreach sets.</p>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="primary">
                <Plus className="w-4 h-4 mr-2" /> Create Campaign
              </Button>
            </div>
          </div>

          {/* Campaigns Grid cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {campaigns.map((camp) => {
              const openRate = camp.metrics.sent > 0 ? Math.round((camp.metrics.opened / camp.metrics.sent) * 100) : 0;
              const replyRate = camp.metrics.sent > 0 ? Math.round((camp.metrics.replied / camp.metrics.sent) * 100) : 0;
              const positiveReplyRate = camp.metrics.replied > 0 ? Math.round((camp.metrics.meetingsBooked / camp.metrics.replied) * 100) : 0;

              return (
                <Card 
                  key={camp.id} 
                  className="p-5 flex flex-col justify-between space-y-6 hover:border-brand-primary cursor-pointer transition-all duration-200 group shadow-sm hover:shadow"
                  onClick={() => setSelectedCampaignId(camp.id)}
                >
                  {/* Header info */}
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-heading font-bold text-text-primary group-hover:text-brand-primary transition-colors">{camp.name}</h3>
                        <span className="text-[10px] text-text-tertiary font-mono block mt-0.5">ID: {camp.id}</span>
                      </div>
                      <div className="flex items-center space-x-1.5" onClick={e => e.stopPropagation()}>
                        {getStatusBadge(camp.status)}
                        <button className="p-1 text-text-tertiary hover:text-text-primary rounded hover:bg-bg-canvas transition">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                      Active sequence targeting B2B leads. Double click to view full campaign analytics and tracking logs.
                    </p>
                  </div>

                  {/* Performance metrics grid */}
                  <div className="grid grid-cols-3 gap-4 border-t border-b border-border-subtle py-4">
                    <div>
                      <span className="text-[10px] uppercase font-heading font-semibold text-text-tertiary block">Sent</span>
                      <span className="text-sm font-heading font-bold text-text-primary block mt-1 tabular-nums">
                        {camp.metrics.sent}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-heading font-semibold text-text-tertiary block">Open Rate</span>
                      <span className="text-sm font-heading font-bold text-text-primary block mt-1 tabular-nums">
                        {openRate}%
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-heading font-semibold text-text-tertiary block">Replies</span>
                      <span className="text-sm font-heading font-bold text-text-primary block mt-1 tabular-nums">
                        {replyRate}%
                      </span>
                    </div>
                  </div>

                  {/* Secondary metrics (positive replies) */}
                  <div className="flex justify-between items-center text-xs text-text-secondary">
                    <div className="flex items-center space-x-1">
                      <Users className="w-4 h-4 text-text-tertiary" />
                      <span>Positive: <strong className="text-brand-primary">{positiveReplyRate}%</strong></span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="px-2.5 h-8"
                        onClick={(e) => toggleCampaignStatus(camp.id, e)}
                      >
                        {camp.status === 'Active' ? (
                          <span className="flex items-center text-status-warning"><Pause className="w-3.5 h-3.5 mr-1" /> Pause</span>
                        ) : (
                          <span className="flex items-center text-status-success"><Play className="w-3.5 h-3.5 mr-1" /> Run</span>
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      ) : (
        // Detail view: detailed campaign tracking screen
        <>
          {/* Header with Back button */}
          <div className="flex items-center space-x-4 border-b border-border-subtle pb-4">
            <button 
              onClick={() => setSelectedCampaignId(null)}
              className="p-1.5 rounded-full border border-border-default hover:bg-bg-canvas hover:text-text-primary text-text-secondary transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className="text-xl font-heading font-bold text-text-primary">{selectedCampaign.name}</h1>
                {getStatusBadge(selectedCampaign.status)}
              </div>
              <p className="text-xs text-text-secondary mt-0.5">Comprehensive tracking logs, recipient analytics, and response rates.</p>
            </div>
          </div>

          {/* Aggregate metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-4">
            {[
              { label: 'Sent', val: selectedCampaign.metrics.sent },
              { label: 'Delivered', val: selectedCampaign.metrics.delivered },
              { label: 'Opened', val: selectedCampaign.metrics.opened },
              { label: 'Replied', val: selectedCampaign.metrics.replied },
              { label: 'Bounced', val: selectedCampaign.metrics.bounced },
              { label: 'LinkedIn Accepted', val: Math.round(selectedCampaign.metrics.sent * 0.45) },
              { label: 'Booked', val: selectedCampaign.metrics.meetingsBooked }
            ].map(m => (
              <Card key={m.label} className="p-3 text-center bg-bg-surface shadow-sm">
                <span className="text-[10px] font-heading font-semibold uppercase tracking-wider text-text-tertiary block">{m.label}</span>
                <span className="text-lg font-heading font-bold text-text-primary block mt-1 tabular-nums">{m.val}</span>
              </Card>
            ))}
          </div>

          {/* Time Series & Channel mix row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Time series progress */}
            <Card className="p-5 lg:col-span-2 space-y-4">
              <div>
                <h3 className="text-sm font-heading font-bold text-text-primary">Performance Progression</h3>
                <p className="text-xs text-text-secondary mt-0.5">Timeline of emails/LinkedIn messages dispatched vs user response actions.</p>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={detailTimeSeriesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="day" stroke="var(--text-secondary)" fontSize={11} />
                    <YAxis stroke="var(--text-secondary)" fontSize={11} />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'var(--bg-surface-raised)',
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)'
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="sent" name="Dispatched" stroke="var(--brand-primary)" strokeWidth={2} />
                    <Line type="monotone" dataKey="opened" name="Opened" stroke="var(--brand-accent)" strokeWidth={2} />
                    <Line type="monotone" dataKey="replied" name="Replied" stroke="#336B66" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Donut channel mix */}
            <Card className="p-5 space-y-4">
              <div>
                <h3 className="text-sm font-heading font-bold text-text-primary">Channel Breakdown</h3>
                <p className="text-xs text-text-secondary mt-0.5">Mix of SMTP Email vs Unipile LinkedIn touchpoints.</p>
              </div>
              <div className="h-48 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelMixData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {channelMixData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-around text-xs font-heading pt-2 border-t border-border-subtle">
                {channelMixData.map(item => (
                  <div key={item.name} className="flex items-center space-x-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-text-secondary">{item.name} ({item.value}%)</span>
                  </div>
                ))}
              </div>
            </Card>

          </div>

          {/* Recipient Tracking Table */}
          <Card className="p-5 space-y-4">
            <div>
              <h3 className="text-sm font-heading font-bold text-text-primary">Recipient Outbound Logs</h3>
              <p className="text-xs text-text-secondary mt-0.5">Timeline status per individual lead target.</p>
            </div>
            
            <div className="overflow-x-auto border border-border-subtle rounded-card bg-bg-surface">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-bg-canvas border-b border-border-default text-xs font-heading font-bold uppercase tracking-wider text-text-secondary">
                    <th className="py-3 px-4">Recipient Name</th>
                    <th className="py-3 px-4">Contact Info</th>
                    <th className="py-3 px-4">Active Channel</th>
                    <th className="py-3 px-4">Log Status</th>
                    <th className="py-3 px-4">Last Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle text-text-primary">
                  {mockRecipients.map((rec, index) => (
                    <tr key={index} className="hover:bg-bg-canvas/30 transition-colors">
                      <td className="py-3.5 px-4 font-heading font-semibold">{rec.name}</td>
                      <td className="py-3.5 px-4 font-mono text-xs">{rec.email}</td>
                      <td className="py-3.5 px-4">
                        <span className="flex items-center space-x-1.5 text-xs text-text-secondary">
                          {rec.channel === 'Email' ? (
                            <Mail className="w-3.5 h-3.5 text-brand-primary" />
                          ) : (
                            <Linkedin className="w-3.5 h-3.5 text-brand-accent" />
                          )}
                          <span>{rec.channel}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="flex items-center space-x-1.5 text-xs font-heading font-semibold">
                          {getRecipientStatusIcon(rec.status)}
                          <span>{rec.status}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-text-tertiary font-heading">{rec.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};
