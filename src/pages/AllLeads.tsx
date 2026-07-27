import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { Badge, ScoreGauge, Drawer, Button, Avatar, Card } from '../components/ui/core';
import { DataTable } from '../components/ui/DataTable';
import {
  ExternalLink, Mail, Phone, Linkedin, Copy, Download, Users, Building2,
  RefreshCw, Filter, Trash2, Send, Database
} from 'lucide-react';
import type { Lead } from '../types/api';
import { toast } from 'sonner';
import { getLeads, deleteLead, bulkDeleteLeads } from '../services/sourcingApi';
import { buildCSVRows, downloadCSVRows } from '../utils/csvExport';
import { EmailComposeModal } from '../components/EmailComposeModal';
import type { EmailRecipient } from '../components/EmailComposeModal';
import { ConfirmDialog } from '../components/ConfirmDialog';

const STATUS_TO_UI: Record<string, Lead['status']> = {
  new: 'New',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_info: 'Needs Info',
};

function domainFromWebsite(website?: string | null): string {
  if (!website) return '';
  return website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

// Same adapter pattern used on the Lead Validation page — turns the raw
// /leads response (real scraped Company + Contact + LeadScore rows) into
// the shared `Lead` UI shape, so this page can reuse the same DataTable/
// Drawer/Badge components rather than inventing a parallel set.
function mapApiLeadToUiLead(raw: any): Lead {
  const domain = domainFromWebsite(raw.company?.website || raw.company?.domain);
  return {
    id: raw.id,
    company: {
      id: raw.company?.id || raw.id,
      name: raw.company?.name || 'Unknown company',
      domain,
      logo: domain ? `https://logo.clearbit.com/${domain}` : '',
      industry: raw.company?.industry || 'Not available',
      location: '',
      employeeCount: raw.company?.employeeCount ?? 0,
      sizeRange: raw.company?.sizeRange || undefined,
      revenueRange: raw.company?.revenueRange || undefined,
      revenueBand: raw.company?.revenueBand || undefined,
      linkedInUrl: raw.company?.linkedin_url || undefined,
      fundingStage: raw.company?.fundingStage || undefined,
      techStack: raw.company?.techStack || [],
      hiringSignals: raw.company?.hiringSignals || [],
      overview: raw.company?.overview || '',
    },
    decisionMaker: {
      id: raw.decisionMaker?.id || `${raw.id}-dm`,
      name: raw.decisionMaker?.full_name || 'Not identified',
      designation: raw.decisionMaker?.designation || 'Not available',
      companyId: raw.company?.id || raw.id,
      email: raw.decisionMaker?.email || undefined,
      phone: raw.decisionMaker?.phone || undefined,
      linkedInUrl: raw.decisionMaker?.linkedin_url || undefined,
      avatarUrl: undefined,
      tenure: undefined,
      scoreExplanation: raw.scoreExplanation || undefined,
      notes: raw.notes || '',
    },
    score: raw.score ?? 0,
    priority: (raw.priority as Lead['priority']) || 'Low',
    status: STATUS_TO_UI[raw.status] || 'New',
    activitySignals: raw.activitySignals || [],
    contactCompleteness: {
      email: !!raw.decisionMaker?.email,
      phone: !!raw.decisionMaker?.phone,
      linkedIn: !!raw.decisionMaker?.linkedin_url,
    },
    sourceJobId: raw.sourceJobId || '',
    sourceJobName: raw.sourceJobName || 'Unknown search',
    dateScraped: raw.dateScraped || new Date().toISOString(),
    scoreFactors: {
      industryFit: 0,
      companySize: 0,
      activityStrength: 0,
      seniorityMatch: 0,
      dataCompleteness: 0,
    },
  };
}

const ALL_STATUSES: Lead['status'][] = ['New', 'Approved', 'Rejected', 'Needs Info'];

export const AllLeads: React.FC = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchModeFilter, setSearchModeFilter] = useState<'individuals' | 'companies'>('individuals');

  const [selectedRows, setSelectedRows] = useState<RowSelectionState>({});
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<Lead['status']>>(new Set());
  const [hasEmailOnly, setHasEmailOnly] = useState(false);
  const [industryFilter, setIndustryFilter] = useState('');
  const [sourceJobFilter, setSourceJobFilter] = useState('');

  const [bulkWorking, setBulkWorking] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeRecipients, setComposeRecipients] = useState<EmailRecipient[]>([]);

  // In-app replacement for window.confirm() — holds whatever destructive
  // action is pending confirmation, run only if the user clicks through.
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const fetchLeads = useCallback(async (mode: 'individuals' | 'companies', silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await getLeads({ searchMode: mode });
      const mapped = (res?.data || []).map(mapApiLeadToUiLead);
      setLeads(mapped);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load workspace leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads(searchModeFilter);
    setSelectedLead(null);
    setSelectedRows({});
  }, [searchModeFilter, fetchLeads]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLeads(searchModeFilter, true);
    setRefreshing(false);
    toast.success('Workspace data refreshed.');
  };

  const industries = useMemo(
    () => Array.from(new Set(leads.map((l) => l.company.industry).filter((i) => i && i !== 'Not available'))).sort(),
    [leads]
  );
  const sourceJobs = useMemo(
    () => Array.from(new Set(leads.map((l) => l.sourceJobName).filter(Boolean))).sort(),
    [leads]
  );

  const filteredLeads = useMemo(() => leads.filter((l) => {
    if (statusFilter.size > 0 && !statusFilter.has(l.status)) return false;
    if (hasEmailOnly && !l.contactCompleteness.email) return false;
    if (industryFilter && l.company.industry !== industryFilter) return false;
    if (sourceJobFilter && l.sourceJobName !== sourceJobFilter) return false;
    return true;
  }), [leads, statusFilter, hasEmailOnly, industryFilter, sourceJobFilter]);

  const activeFilterCount = statusFilter.size + (hasEmailOnly ? 1 : 0) + (industryFilter ? 1 : 0) + (sourceJobFilter ? 1 : 0);
  const clearFilters = () => {
    setStatusFilter(new Set());
    setHasEmailOnly(false);
    setIndustryFilter('');
    setSourceJobFilter('');
  };
  const toggleStatusFilter = (status: Lead['status']) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard.');
  };

  const leadToRecipient = (lead: Lead): EmailRecipient => ({
    id: lead.id,
    name: lead.decisionMaker.name,
    email: lead.decisionMaker.email,
    company: lead.company.name,
    title: lead.decisionMaker.designation,
  });

  const toCsvLead = (l: Lead) => ({
    score: l.score,
    company: { name: l.company.name, industry: l.company.industry, website: l.company.domain, linkedinUrl: '', overview: l.company.overview },
    decisionMaker: { full_name: l.decisionMaker.name, designation: l.decisionMaker.designation, email: l.decisionMaker.email, phone: l.decisionMaker.phone, linkedin_url: l.decisionMaker.linkedInUrl },
    activitySignals: l.activitySignals,
  });

  const handleExportCSV = (rows: Lead[]) => {
    if (rows.length === 0) {
      toast.info('No leads to export.');
      return;
    }
    downloadCSVRows(
      buildCSVRows(rows.map(toCsvLead), searchModeFilter),
      `all-${searchModeFilter}-${new Date().toISOString().slice(0, 10)}.csv`
    );
    toast.success(`Exported ${rows.length} lead${rows.length === 1 ? '' : 's'}.`);
  };

  const selectedIndices = Object.keys(selectedRows).filter((k) => selectedRows[k]);
  const selectedLeadObjs = selectedIndices.map((idx) => filteredLeads[parseInt(idx, 10)]).filter(Boolean);

  const handleBulkSendEmail = () => {
    if (selectedLeadObjs.length === 0) return;
    setComposeRecipients(selectedLeadObjs.map(leadToRecipient));
    setComposeOpen(true);
  };

  const handleSendOne = (lead: Lead) => {
    setComposeRecipients([leadToRecipient(lead)]);
    setComposeOpen(true);
  };

  const handleDeleteOne = (lead: Lead) => {
    setConfirmAction({
      message: `Delete ${lead.decisionMaker.name} at ${lead.company.name}? This can't be undone.`,
      onConfirm: async () => {
        setConfirmAction(null);
        try {
          await deleteLead(lead.id);
          toast.success('Lead deleted.');
          setLeads((prev) => prev.filter((l) => l.id !== lead.id));
          if (selectedLead?.id === lead.id) setSelectedLead(null);
        } catch (e: any) {
          toast.error(e?.message || 'Failed to delete lead.');
        }
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedLeadObjs.length === 0) return;
    setConfirmAction({
      message: `Delete ${selectedLeadObjs.length} lead(s)? This can't be undone.`,
      onConfirm: async () => {
        setConfirmAction(null);
        setBulkWorking(true);
        try {
          const res = await bulkDeleteLeads(selectedLeadObjs.map((l) => l.id));
          toast.success(`Deleted ${res.deleted} of ${res.requested} lead(s).`);
          setSelectedRows({});
          await fetchLeads(searchModeFilter, true);
        } catch (e: any) {
          toast.error(e?.message || 'Bulk delete failed.');
        } finally {
          setBulkWorking(false);
        }
      },
    });
  };

  const columns: ColumnDef<Lead>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
          className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={(e) => row.toggleSelected(!!e.target.checked)}
          className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
        />
      ),
      size: 40,
    },
    {
      id: 'company',
      header: 'Company',
      accessorFn: (row) => row.company.name,
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex items-center space-x-2.5">
            <img
              src={lead.company.logo}
              alt={lead.company.name}
              className="w-6 h-6 rounded bg-bg-canvas object-contain"
              onError={(e) => { (e.target as any).style.display = 'none'; }}
            />
            <div>
              <span className="font-heading font-semibold text-text-primary block text-sm">{lead.company.name}</span>
              {lead.company.domain && (
                <a href={`https://${lead.company.domain}`} target="_blank" rel="noreferrer" className="text-[10px] text-text-tertiary flex items-center hover:text-brand-primary">
                  {lead.company.domain} <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                </a>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: 'decisionMaker',
      header: 'Decision Maker',
      accessorFn: (row) => row.decisionMaker.name,
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex items-center space-x-2.5">
            <Avatar name={lead.decisionMaker.name} size="sm" />
            <div>
              <span className="font-heading font-medium text-text-primary block text-xs">{lead.decisionMaker.name}</span>
              <span className="text-[10px] text-text-secondary block truncate max-w-[150px]">{lead.decisionMaker.designation}</span>
            </div>
          </div>
        );
      },
    },
    {
      id: 'score',
      header: 'Score',
      accessorKey: 'score',
      cell: ({ row }) => (
        <div className="flex items-center space-x-2">
          <ScoreGauge score={row.original.score} size={28} strokeWidth={3} />
          <Badge variant={row.original.priority === 'High' ? 'high' : row.original.priority === 'Medium' ? 'medium' : 'low'}>
            {row.original.priority}
          </Badge>
        </div>
      ),
    },
    {
      id: 'completeness',
      header: 'Contact',
      cell: ({ row }) => {
        const comp = row.original.contactCompleteness;
        return (
          <div className="flex items-center space-x-1.5 text-text-secondary">
            <Mail className={`w-3.5 h-3.5 ${comp.email ? 'text-brand-primary' : 'text-text-tertiary opacity-40'}`} />
            <Phone className={`w-3.5 h-3.5 ${comp.phone ? 'text-brand-primary' : 'text-text-tertiary opacity-40'}`} />
            <Linkedin className={`w-3.5 h-3.5 ${comp.linkedIn ? 'text-brand-primary' : 'text-text-tertiary opacity-40'}`} />
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      cell: ({ row }) => {
        const status = row.original.status;
        let variant: any = 'neutral';
        if (status === 'Approved') variant = 'success';
        else if (status === 'Rejected') variant = 'danger';
        else if (status === 'Needs Info') variant = 'warning';
        return <Badge variant={variant}>{status}</Badge>;
      },
    },
    {
      id: 'source',
      header: 'Source Job',
      accessorFn: (row) => row.sourceJobName,
      cell: ({ row }) => <span className="text-xs text-text-secondary">{row.original.sourceJobName}</span>,
    },
    {
      id: 'dateScraped',
      header: 'Scraped',
      accessorFn: (row) => row.dateScraped,
      cell: ({ row }) => <span className="text-xs text-text-secondary">{new Date(row.original.dateScraped).toLocaleDateString()}</span>,
    },
    {
      id: 'actions',
      header: 'Action',
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
            {lead.decisionMaker.email && (
              <Button variant="ghost" size="icon" className="w-9 h-9 text-text-tertiary hover:bg-brand-primary/10 hover:text-brand-primary transition-colors" title="Send email" onClick={() => handleSendOne(lead)}>
                <Send className="w-5 h-5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="w-9 h-9 text-text-tertiary hover:bg-status-danger-bg hover:text-status-danger transition-colors" title="Delete" onClick={() => handleDeleteOne(lead)}>
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">All Leads</h1>
          <p className="text-xs text-text-secondary mt-1">Every company and individual scraped into this workspace, across every job.</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="inline-flex rounded-input border border-border-default overflow-hidden">
            <button
              type="button"
              onClick={() => setSearchModeFilter('individuals')}
              className={`flex items-center px-3 py-1.5 text-xs font-heading font-semibold transition ${searchModeFilter === 'individuals' ? 'bg-brand-primary text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'}`}
            >
              <Users className="w-3.5 h-3.5 mr-1.5" /> Individuals
            </button>
            <button
              type="button"
              onClick={() => setSearchModeFilter('companies')}
              className={`flex items-center px-3 py-1.5 text-xs font-heading font-semibold transition border-l border-border-default ${searchModeFilter === 'companies' ? 'bg-brand-primary text-white' : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'}`}
            >
              <Building2 className="w-3.5 h-3.5 mr-1.5" /> Companies
            </button>
          </div>
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4 mr-2" /> Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 bg-brand-primary text-white text-[10px] font-bold rounded-full w-4 h-4 inline-flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button variant="secondary" onClick={handleRefresh} loading={refreshing}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button variant="secondary" onClick={() => handleExportCSV(filteredLeads)}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card className="p-4 space-y-3">
          <div>
            <span className="block text-[10px] font-heading font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map((status) => {
                const active = statusFilter.has(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatusFilter(status)}
                    className={`text-xs px-2.5 py-1 rounded-badge border transition ${active ? 'bg-brand-primary text-white border-brand-primary font-medium' : 'bg-bg-surface hover:bg-bg-canvas text-text-secondary border-border-default'}`}
                  >
                    {status}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={hasEmailOnly} onChange={(e) => setHasEmailOnly(e.target.checked)} className="rounded border-border-default text-brand-primary focus:ring-brand-primary" />
              Has email only
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-heading font-semibold text-text-tertiary uppercase tracking-wider">Industry</span>
              <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="text-xs px-2 py-1 bg-bg-surface border border-border-default rounded-btn text-text-primary focus:outline-none">
                <option value="">All industries</option>
                {industries.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-heading font-semibold text-text-tertiary uppercase tracking-wider">Source job</span>
              <select value={sourceJobFilter} onChange={(e) => setSourceJobFilter(e.target.value)} className="text-xs px-2 py-1 bg-bg-surface border border-border-default rounded-btn text-text-primary focus:outline-none">
                <option value="">All jobs</option>
                {sourceJobs.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="text-xs text-brand-primary hover:underline font-heading font-medium">
              Clear all filters
            </button>
          )}
        </Card>
      )}

      {/* Empty state */}
      {!loading && leads.length === 0 && (
        <Card className="text-center py-16">
          <Database className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
          <h3 className="text-base font-heading font-semibold text-text-primary">Nothing scraped yet</h3>
          <p className="text-xs text-text-secondary mt-1">
            Go to <strong>Lead Search</strong> and run a search — everything it finds will show up here.
          </p>
        </Card>
      )}

      {(loading || leads.length > 0) && (
        <DataTable
          columns={columns}
          data={filteredLeads}
          loading={loading}
          searchKey="company"
          searchPlaceholder="Search by company name..."
          onRowClick={(row) => setSelectedLead(row)}
          selectedRows={selectedRows}
          onRowSelectionChange={setSelectedRows}
          emptyState={
            <div className="text-center py-6 text-xs text-text-secondary">
              No leads match the current filters.
            </div>
          }
          bulkActions={
            <>
              <Button variant="ghost" className="text-white hover:bg-white/10 text-xs px-2.5 h-8" onClick={handleBulkSendEmail}>
                <Send className="w-3.5 h-3.5 mr-1" /> Send Email
              </Button>
              <Button variant="ghost" className="text-white hover:bg-white/10 text-xs px-2.5 h-8" onClick={handleBulkDelete} disabled={bulkWorking}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
              </Button>
              <Button variant="secondary" className="text-xs px-2.5 h-8 bg-white text-text-primary border-none hover:bg-white/90" onClick={() => handleExportCSV(selectedLeadObjs)}>
                <Download className="w-3.5 h-3.5 mr-1 text-text-secondary" /> Export CSV
              </Button>
            </>
          }
        />
      )}

      {/* Detail drawer — everything scraped about this lead */}
      <Drawer
        isOpen={selectedLead !== null}
        onClose={() => setSelectedLead(null)}
        title={selectedLead ? `${selectedLead.decisionMaker.name} · ${selectedLead.company.name}` : ''}
        footer={
          selectedLead && (
            <div className="flex justify-between w-full items-center">
              <Badge variant={selectedLead.status === 'Approved' ? 'success' : selectedLead.status === 'Rejected' ? 'danger' : 'neutral'}>
                {selectedLead.status}
              </Badge>
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" onClick={() => handleDeleteOne(selectedLead)} icon={Trash2}>
                  Delete
                </Button>
                {selectedLead.decisionMaker.email && (
                  <Button variant="primary" size="sm" onClick={() => handleSendOne(selectedLead)} icon={Send}>
                    Send Email
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {selectedLead && (
          <div className="space-y-6">
            <div className="flex items-start space-x-4 bg-bg-canvas p-4 rounded-card border border-border-subtle">
              <Avatar name={selectedLead.decisionMaker.name} size="lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-heading font-semibold text-text-primary">{selectedLead.decisionMaker.name}</h3>
                <span className="text-xs text-text-secondary block font-medium mt-0.5">{selectedLead.decisionMaker.designation}</span>
                <div className="flex items-center space-x-2 mt-3 bg-bg-surface px-2.5 py-1 rounded-badge border border-border-default max-w-max">
                  <ScoreGauge score={selectedLead.score} size={28} strokeWidth={3} />
                  <span className="text-xs font-heading font-semibold text-text-primary">Match score: {selectedLead.score}/100</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Contact</h4>
              <div className="border border-border-subtle rounded-card divide-y divide-border-subtle overflow-hidden">
                <div className="p-3 flex items-center justify-between text-xs hover:bg-bg-canvas/30 transition">
                  <div className="flex items-center space-x-2"><Mail className="w-4 h-4 text-text-tertiary" /><span className="font-medium text-text-secondary">Email</span></div>
                  {selectedLead.decisionMaker.email ? (
                    <div className="flex items-center space-x-2 font-mono">
                      <span>{selectedLead.decisionMaker.email}</span>
                      <button onClick={() => handleCopy(selectedLead.decisionMaker.email!)} className="p-1 hover:bg-bg-canvas rounded text-text-secondary"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : <span className="text-text-tertiary italic">Not enriched</span>}
                </div>
                <div className="p-3 flex items-center justify-between text-xs hover:bg-bg-canvas/30 transition">
                  <div className="flex items-center space-x-2"><Phone className="w-4 h-4 text-text-tertiary" /><span className="font-medium text-text-secondary">Phone</span></div>
                  {selectedLead.decisionMaker.phone ? (
                    <div className="flex items-center space-x-2 font-mono">
                      <span>{selectedLead.decisionMaker.phone}</span>
                      <button onClick={() => handleCopy(selectedLead.decisionMaker.phone!)} className="p-1 hover:bg-bg-canvas rounded text-text-secondary"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : <span className="text-text-tertiary italic">Not enriched</span>}
                </div>
                <div className="p-3 flex items-center justify-between text-xs hover:bg-bg-canvas/30 transition">
                  <div className="flex items-center space-x-2"><Linkedin className="w-4 h-4 text-text-tertiary" /><span className="font-medium text-text-secondary">LinkedIn</span></div>
                  {selectedLead.decisionMaker.linkedInUrl ? (
                    <a href={selectedLead.decisionMaker.linkedInUrl} target="_blank" rel="noreferrer" className="text-brand-primary font-semibold flex items-center hover:underline">
                      View Profile <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  ) : <span className="text-text-tertiary italic">No link</span>}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Company</h4>
              <div className="p-4 bg-bg-canvas/50 border border-border-subtle rounded-card space-y-3">
                <div className="flex justify-between text-xs"><span className="text-text-secondary">Employees:</span><span className="font-semibold text-text-primary tabular-nums">{selectedLead.company.employeeCount || selectedLead.company.sizeRange || '—'}</span></div>
                {selectedLead.company.revenueRange && (
                  <div className="flex justify-between text-xs"><span className="text-text-secondary">Revenue:</span><span className="font-semibold text-text-primary tabular-nums">{selectedLead.company.revenueRange}</span></div>
                )}
                <div className="flex justify-between text-xs"><span className="text-text-secondary">Industry:</span><span className="font-semibold text-text-primary">{selectedLead.company.industry}</span></div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-text-secondary">LinkedIn:</span>
                  {selectedLead.company.linkedInUrl ? (
                    <a href={selectedLead.company.linkedInUrl} target="_blank" rel="noreferrer" className="text-brand-primary font-semibold flex items-center hover:underline">
                      View Company Profile <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  ) : <span className="text-text-tertiary italic">No link</span>}
                </div>
                {selectedLead.company.fundingStage && (
                  <div className="flex justify-between text-xs"><span className="text-text-secondary">Funding:</span><Badge variant="warning">{selectedLead.company.fundingStage}</Badge></div>
                )}
                {!!selectedLead.company.techStack?.length && (
                  <div className="flex justify-between text-xs"><span className="text-text-secondary">Tech Stack:</span><span className="font-semibold text-text-primary text-[10px] text-right">{selectedLead.company.techStack.join(', ')}</span></div>
                )}
                {(!!selectedLead.company.hiringSignals?.length || !!selectedLead.activitySignals?.length) && (
                  <div className="border-t border-border-subtle pt-3 space-y-2">
                    <span className="block text-xs font-heading font-semibold text-text-primary">Activity</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLead.company.hiringSignals?.map((sig, idx) => <Badge key={idx} variant="info" className="text-[10px]">Hiring: {sig}</Badge>)}
                      {selectedLead.activitySignals?.map((sig, idx) => <Badge key={idx} variant="success" className="text-[10px]">{sig}</Badge>)}
                    </div>
                  </div>
                )}
                {selectedLead.company.overview && (
                  <p className="text-xs text-text-secondary border-t border-border-subtle pt-3 leading-relaxed">{selectedLead.company.overview}</p>
                )}
              </div>
            </div>

            <div className="space-y-2 text-[11px] text-text-tertiary">
              <span>Source: {selectedLead.sourceJobName} · Scraped {new Date(selectedLead.dateScraped).toLocaleDateString()}</span>
            </div>

            {selectedLead.decisionMaker.notes && (
              <div className="space-y-2">
                <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Internal Notes</h4>
                <p className="text-xs text-text-secondary bg-bg-canvas p-3 rounded-card border border-border-subtle whitespace-pre-wrap">{selectedLead.decisionMaker.notes}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <EmailComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        recipients={composeRecipients}
        onSent={() => setSelectedRows({})}
      />

      <ConfirmDialog
        isOpen={confirmAction !== null}
        message={confirmAction?.message || ''}
        confirmLabel="Delete"
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
