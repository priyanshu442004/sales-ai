import React, { useEffect, useState } from 'react';
import { Card, Badge, Button } from '../components/ui/core';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { TrendingUp, Coins, Calendar, Filter, FileSpreadsheet, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { getAnalyticsSummary } from '../services/sourcingApi';
import { downloadCSVRows } from '../utils/csvExport';

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: 'var(--brand-primary)',
  Neutral: '#336B66',
  Negative: '#991B1B',
  'Out-of-office': '#C8863A',
};

interface AnalyticsSummary {
  range: string;
  emailPerformance: { date: string; sent: number; failed: number }[];
  sentiment: { name: string; value: number }[];
  apiUsage: { date: string; calls: number }[];
  funnel: { name: string; value: number }[];
  replyRate: number;
  totals: { sent: number; failed: number };
}

export const Analytics: React.FC = () => {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAnalyticsSummary(dateRange)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((e) => console.error('Failed to load analytics summary:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateRange]);

  const handleExportCSV = () => {
    if (!summary) return;
    const rows: string[][] = [
      ['Metric', 'Value'],
      ['Date range', summary.range],
      ['Reply rate', `${summary.replyRate}%`],
      ['Emails sent', String(summary.totals.sent)],
      ['Emails failed', String(summary.totals.failed)],
      [],
      ['Funnel stage', 'Count'],
      ...summary.funnel.map((f) => [f.name, String(f.value)]),
      [],
      ['Date', 'Sent', 'Failed'],
      ...summary.emailPerformance.map((d) => [d.date, String(d.sent), String(d.failed)]),
      [],
      ['Date', 'SerpAPI calls'],
      ...summary.apiUsage.map((d) => [d.date, String(d.calls)]),
    ];
    downloadCSVRows(rows, `analytics-${summary.range}-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success('Analytics exported as CSV.');
  };

  const handlePrint = () => {
    window.print();
  };

  const sentimentData = (summary?.sentiment || []).map((s) => ({
    ...s,
    color: SENTIMENT_COLORS[s.name] || '#438D86',
  }));

  const totalEmails = summary ? summary.totals.sent + summary.totals.failed : 0;
  const deliveryRate = totalEmails > 0 ? Math.round((summary!.totals.sent / totalEmails) * 100) : null;

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-border-subtle pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Performance Analytics</h1>
          <p className="text-xs text-text-secondary mt-1">Real conversion metrics, SerpAPI credit consumption, and reply sentiment — computed from your own data.</p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="secondary" size="sm" icon={FileSpreadsheet} onClick={handleExportCSV} disabled={!summary}>
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" icon={Printer} onClick={handlePrint}>
            Print / Save PDF
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-bg-surface p-3 rounded-card border border-border-subtle shadow-sm">
        <div className="flex items-center space-x-2 text-xs text-text-secondary">
          <Filter className="w-3.5 h-3.5" />
          <span className="font-heading font-semibold">Date Range:</span>
        </div>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as any)}
          className="bg-bg-canvas border border-border-default text-text-primary text-xs rounded-btn py-1 px-2 focus:outline-none focus:ring-1 focus:ring-brand-primary"
        >
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
        </select>

        <div className="ml-auto text-[11px] text-text-tertiary flex items-center space-x-1.5 font-heading">
          <Calendar className="w-3.5 h-3.5" />
          <span>{loading ? 'Loading...' : 'Live data'}</span>
        </div>
      </div>

      {/* Primary bar chart & Pie chart row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Email send performance */}
        <Card className="p-5 lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-heading font-bold text-text-primary">Email Send Performance</h3>
              <p className="text-xs text-text-secondary mt-0.5">Real sent vs. failed cold email counts per day.</p>
            </div>
            {deliveryRate !== null && (
              <Badge variant={deliveryRate >= 90 ? 'success' : 'warning'}>
                <TrendingUp className="w-3.5 h-3.5 mr-1" />
                {deliveryRate}% delivered
              </Badge>
            )}
          </div>

          {!summary || summary.emailPerformance.every((d) => d.sent === 0 && d.failed === 0) ? (
            <div className="h-72 flex items-center justify-center text-xs text-text-tertiary italic">
              {loading ? 'Loading...' : 'No emails sent in this range yet.'}
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.emailPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={11} />
                  <YAxis stroke="var(--text-secondary)" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-surface-raised)',
                      borderColor: 'var(--border-default)',
                      color: 'var(--text-primary)'
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sent" name="Sent" stackId="a" fill="var(--brand-primary)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="failed" name="Failed" stackId="a" fill="#991B1B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Sentiment Pie Chart */}
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-heading font-bold text-text-primary">Inbox Reply Sentiment</h3>
            <p className="text-xs text-text-secondary mt-0.5">Real classified reply threads.</p>
          </div>

          {sentimentData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-text-tertiary italic text-center px-4">
              {loading ? 'Loading...' : 'No reply threads yet.'}
            </div>
          ) : (
            <>
              <div className="h-60 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sentimentData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {sentimentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] text-text-secondary border-t border-border-subtle pt-3">
                {sentimentData.map(item => (
                  <div key={item.name} className="flex items-center space-x-1.5 font-heading">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="truncate">{item.name} ({item.value})</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

      </div>

      {/* SerpAPI usage bar chart */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-heading font-bold text-text-primary">SerpAPI Usage</h3>
            <p className="text-xs text-text-secondary mt-0.5">Real outbound calls made to SerpAPI while sourcing leads.</p>
          </div>
          <div className="flex items-center space-x-1 text-xs text-text-tertiary">
            <Coins className="w-4 h-4 text-brand-primary" />
            <span>{summary ? summary.apiUsage.reduce((sum, d) => sum + d.calls, 0) : 0} calls in range</span>
          </div>
        </div>

        {!summary || summary.apiUsage.every((d) => d.calls === 0) ? (
          <div className="h-64 flex items-center justify-center text-xs text-text-tertiary italic">
            {loading ? 'Loading...' : 'No SerpAPI calls recorded in this range.'}
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.apiUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={11} />
                <YAxis stroke="var(--text-secondary)" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface-raised)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)'
                  }}
                />
                <Bar dataKey="calls" name="SerpAPI Calls" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

    </div>
  );
};
