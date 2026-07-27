import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  KpiCard, Card, Sparkline, Badge, ScoreGauge, Button, Skeleton
} from '../components/ui/core';
import {
  BarChart, Bar, PieChart, Pie, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, LabelList
} from 'recharts';
import {
  Search, ArrowRight, ShieldAlert
} from 'lucide-react';
import {
  getDashboardKpis, getDashboardFunnel, getDashboardLeadsOverTime,
  getDashboardActivities, getDashboardAttention,
} from '../services/sourcingApi';

interface KpiBlock { value: number; sparkline: number[]; }
interface DashboardKpis {
  activeScrapes: KpiBlock;
  leadsForReview: KpiBlock;
  pendingSends: KpiBlock;
  repliesThisWeek: KpiBlock;
}
interface FunnelStage { name: string; value: number; }
interface Activity { actor: string; action: string; details: string; time: string; }
interface AttentionItem { type: string; title: string; desc: string; priority: string; score: number | null; link: string; }
interface LeadsOverTimePoint { date: string; total: number; }

const FUNNEL_COLORS = ['var(--brand-primary)', '#27524E', '#336B66', '#438D86'];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatShortDate(iso: unknown): string {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const Dashboard: React.FC = () => {
  // Every section below loads independently — its own fetch, its own
  // loading flag, its own skeleton — so a slow section never holds up the
  // others from appearing as soon as they're ready.
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [replyRate, setReplyRate] = useState(0);
  const [funnelLoading, setFunnelLoading] = useState(true);

  const [leadsOverTime, setLeadsOverTime] = useState<LeadsOverTimePoint[]>([]);
  const [leadsOverTimeLoading, setLeadsOverTimeLoading] = useState(true);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(true);

  useEffect(() => {
    getDashboardKpis()
      .then(setKpis)
      .catch((e) => console.error('Failed to load dashboard KPIs:', e))
      .finally(() => setKpisLoading(false));

    getDashboardFunnel()
      .then((data) => { setFunnel(data.funnel || []); setReplyRate(data.replyRate || 0); })
      .catch((e) => console.error('Failed to load dashboard funnel:', e))
      .finally(() => setFunnelLoading(false));

    getDashboardLeadsOverTime(30)
      .then((data) => setLeadsOverTime(data.series || []))
      .catch((e) => console.error('Failed to load leads-over-time:', e))
      .finally(() => setLeadsOverTimeLoading(false));

    getDashboardActivities()
      .then((data) => setActivities(data.activities || []))
      .catch((e) => console.error('Failed to load dashboard activities:', e))
      .finally(() => setActivitiesLoading(false));

    getDashboardAttention()
      .then((data) => setAttentionItems(data.attentionItems || []))
      .catch((e) => console.error('Failed to load dashboard attention items:', e))
      .finally(() => setAttentionLoading(false));
  }, []);

  const funnelData = funnel.map((f, i) => ({ ...f, color: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }));
  const hasLeadsOverTimeData = leadsOverTime.some((p) => p.total > 0);

  return (
    <div className="space-y-6 fade-in">
      {/* 1. Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Executive Dashboard</h1>
          <p className="text-xs text-text-secondary mt-1">Review active Sales AI searches, scrape jobs status, and pending approvals.</p>
        </div>
        <div className="flex items-center space-x-3">
          <Link to="/search">
            <Button variant="primary" icon={Search}>Start New Search</Button>
          </Link>
        </div>
      </div>

      {/* 2. KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpisLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
            </Card>
          ))
        ) : (
          <>
            <div className="relative">
              <KpiCard title="Active Scrapes" value={kpis?.activeScrapes.value ?? 0} />
              <div className="absolute right-6 bottom-4"><Sparkline data={kpis?.activeScrapes.sparkline || []} /></div>
            </div>
            <div className="relative">
              <KpiCard title="Leads For Review" value={kpis?.leadsForReview.value ?? 0} />
              <div className="absolute right-6 bottom-4"><Sparkline data={kpis?.leadsForReview.sparkline || []} /></div>
            </div>
            <div className="relative">
              <KpiCard title="Pending Sends" value={kpis?.pendingSends.value ?? 0} />
              <div className="absolute right-6 bottom-4"><Sparkline data={kpis?.pendingSends.sparkline || []} /></div>
            </div>
            <div className="relative">
              <KpiCard title="Replies This Week" value={kpis?.repliesThisWeek.value ?? 0} />
              <div className="absolute right-6 bottom-4"><Sparkline data={kpis?.repliesThisWeek.sparkline || []} /></div>
            </div>
          </>
        )}
      </div>

      {/* 3. Mid Section: Funnel (bar + pie + trend line) & Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Funnel Card */}
        <Card className="p-5 lg:col-span-2 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-heading font-bold text-text-primary">Outbound Conversion Funnel</h3>
              <p className="text-xs text-text-secondary mt-0.5">Real counts from your own scraped leads and sent messages.</p>
            </div>
            {!funnelLoading && <Badge variant="success">{replyRate}% Reply Rate</Badge>}
          </div>

          {/* Bar chart + Pie chart, exactly 50/50 with a divider between them */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:divide-x md:divide-border-subtle">
            <div>
              {funnelLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : funnelData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-xs text-text-tertiary italic">
                  No leads yet — run a search to populate this funnel.
                </div>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={funnelData}
                      layout="vertical"
                      margin={{ top: 10, right: 30, left: 90, bottom: 5 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        stroke="var(--text-secondary)"
                        fontSize={12}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                        contentStyle={{
                          backgroundColor: 'var(--bg-surface-raised)',
                          borderColor: 'var(--border-default)',
                          color: 'var(--text-primary)',
                          fontSize: 12
                        }}
                      />
                      <Bar dataKey="value" barSize={20} radius={[0, 4, 4, 0]}>
                        {funnelData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                        <LabelList dataKey="value" position="right" style={{ fill: 'var(--text-primary)', fontSize: 11, fontFamily: 'Inter', fontWeight: 600 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Pie chart — same funnel data, proportional view. Legend is
                always rendered (not just on hover) so it's clear what each
                slice represents at a glance; the Tooltip stays for exact
                on-demand values. */}
            <div className="md:pl-6">
              {funnelLoading ? (
                <Skeleton className="h-56 w-full rounded-full" />
              ) : funnelData.length === 0 || funnelData.every((f) => f.value === 0) ? (
                <div className="h-56 flex items-center justify-center text-xs text-text-tertiary italic text-center px-2">
                  No data yet
                </div>
              ) : (
                <div className="h-56 flex flex-col">
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={funnelData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={64}
                          paddingAngle={3}
                        >
                          {funnelData.map((entry, index) => (
                            <Cell key={`pie-cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--bg-surface-raised)',
                            borderColor: 'var(--border-default)',
                            color: 'var(--text-primary)',
                            fontSize: 12
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-2 shrink-0">
                    {funnelData.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                        <span className="text-[11px] text-text-secondary">{entry.name}</span>
                        <span className="text-[11px] font-heading font-semibold text-text-primary tabular-nums">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Trend line — total scraped leads over time (last 30 days) */}
          <div className="border-t border-border-subtle pt-4">
            <h4 className="text-xs font-heading font-semibold text-text-primary mb-2">Total Scraped Leads Over Time</h4>
            {leadsOverTimeLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !hasLeadsOverTimeData ? (
              <div className="h-40 flex items-center justify-center text-xs text-text-tertiary italic">
                No leads scraped in the last 30 days yet.
              </div>
            ) : (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={leadsOverTime} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      stroke="var(--text-secondary)"
                      fontSize={10}
                      interval="preserveStartEnd"
                    />
                    <YAxis stroke="var(--text-secondary)" fontSize={10} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={formatShortDate}
                      contentStyle={{
                        backgroundColor: 'var(--bg-surface-raised)',
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                        fontSize: 12
                      }}
                    />
                    <Line type="monotone" dataKey="total" name="Total leads" stroke="var(--brand-primary)" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Card>

        {/* Activity Feed Card */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-heading font-bold text-text-primary">Recent Activity Feed</h3>
            <Link to="/audit-log" className="text-xs text-brand-primary hover:text-brand-primary-hover font-heading font-semibold">
              View Audit Log
            </Link>
          </div>

          {activitiesLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="text-xs text-text-tertiary italic text-center py-6">
              No activity yet.
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map((act, index) => (
                <div key={index} className="flex items-start space-x-3 text-xs border-b border-border-subtle pb-3 last:border-b-0 last:pb-0">
                  <div className="w-1.5 h-1.5 bg-brand-primary rounded-full shrink-0 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-heading font-semibold text-text-primary">{act.actor}</span>
                      <span className="text-[10px] text-text-tertiary tabular-nums font-heading">{timeAgo(act.time)}</span>
                    </div>
                    <span className="text-text-secondary block mt-0.5">{act.action}</span>
                    {act.details && (
                      <span className="text-[11px] font-mono text-text-tertiary mt-0.5 block truncate bg-bg-canvas px-1 py-0.5 rounded border border-border-subtle">
                        {act.details}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 4. Bottom Section: Attention Queue */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-status-danger" />
            <h3 className="text-sm font-heading font-bold text-text-primary">Needs Your Attention</h3>
          </div>
          {!attentionLoading && <Badge variant="high">{attentionItems.length} Urgent Action Items</Badge>}
        </div>

        {attentionLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4 space-y-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-full" />
              </Card>
            ))}
          </div>
        ) : attentionItems.length === 0 ? (
          <div className="text-xs text-text-tertiary italic text-center py-8">
            Nothing needs your attention right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {attentionItems.map((item, index) => (
              <div
                key={index}
                className="border border-border-default hover:border-brand-primary p-4 rounded-card bg-bg-canvas/30 hover:bg-bg-canvas/60 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase font-heading font-bold tracking-wider text-text-secondary bg-bg-surface px-2 py-0.5 rounded border border-border-subtle">
                      {item.type}
                    </span>
                    <Badge variant={item.priority === 'High' ? 'high' : 'medium'}>{item.priority} Priority</Badge>
                  </div>
                  <h4 className="text-sm font-heading font-semibold text-text-primary leading-tight mt-2">{item.title}</h4>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">{item.desc}</p>
                </div>

                <div className="mt-4 flex items-center justify-between pt-3 border-t border-border-subtle">
                  <div className="flex items-center space-x-2">
                    {item.score !== null ? (
                      <>
                        <ScoreGauge score={item.score} size={28} strokeWidth={3} />
                        <span className="text-[11px] font-heading font-medium text-text-tertiary">Match Fit</span>
                      </>
                    ) : (
                      <span className="text-[11px] font-heading font-medium text-text-tertiary">Awaiting review</span>
                    )}
                  </div>
                  <Link to={item.link}>
                    <Button variant="ghost" size="sm" className="text-xs font-semibold px-2 py-1 flex items-center text-brand-primary">
                      Action <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
