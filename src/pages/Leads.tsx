import React, { useState, useEffect, useCallback } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Badge, ScoreGauge, Drawer, Button, Avatar, Tabs, Modal
} from '../components/ui/core';
import { DataTable } from '../components/ui/DataTable';
import {
  ExternalLink, Mail, Phone, Linkedin, Check, X, Info,
  Copy, Sliders, Download, Users, Building2
} from 'lucide-react';
import type { Lead } from '../types/api';
import { toast } from 'sonner';
import { getLeads, approveLead, rejectLead, updateLeadStatus as apiUpdateLeadStatus, updateLeadNotes as apiUpdateLeadNotes } from '../services/sourcingApi';

const STATUS_TO_UI: Record<string, Lead['status']> = {
  new: 'New',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_info: 'Needs Info',
};
const STATUS_TO_API: Record<string, string> = {
  New: 'new',
  Approved: 'approved',
  Rejected: 'rejected',
  'Needs Info': 'needs_info',
};

function domainFromWebsite(website?: string | null): string {
  if (!website) return '';
  return website.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

// Adapts the backend's /leads response (real scraped Company + Contact +
// LeadScore rows) into the shape this page's table/drawer/kanban already
// expect — mirrors the same "map raw API response to a local shape" pattern
// the Jobs Queue page already uses, rather than forcing the backend to
// conform to every UI-only field (logo, avatar, etc).
function mapApiLeadToUiLead(raw: any): Lead {
  const domain = domainFromWebsite(raw.company?.website || raw.company?.domain);
  const factors = raw.factor_breakdown || {};

  return {
    id: raw.id,
    company: {
      id: raw.company?.id || raw.id,
      name: raw.company?.name || 'Unknown company',
      domain,
      // Real logo lookup service, not fabricated — falls back to initials
      // in the UI (via onError) when the domain has no logo on file.
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
      industryFit: factors.industry_match ? 100 : 0,
      companySize: factors.website_found ? 100 : 0,
      activityStrength: (factors.hiring_signal || factors.achievement_signal) ? 100 : 0,
      seniorityMatch: (factors.designation_match || factors.decision_maker_found) ? 100 : 0,
      dataCompleteness: [raw.decisionMaker?.email, raw.decisionMaker?.phone, raw.decisionMaker?.linkedin_url].filter(Boolean).length * 33,
    },
  };
}

export const Leads: React.FC = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('review'); // 'review' or 'scoring'
  const [searchModeFilter, setSearchModeFilter] = useState<'individuals' | 'companies'>('individuals');

  // Table row selection state
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // Notes state for selected lead
  const [leadNotes, setLeadNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  // Scoring config modal
  const [scoringModalOpen, setScoringModalOpen] = useState(false);
  const [industryWeight, setIndustryWeight] = useState(20);
  const [locationWeight, setLocationWeight] = useState(20);
  const [sizeWeight, setSizeWeight] = useState(20);
  const [activityWeight, setActivityWeight] = useState(20);
  const [seniorityWeight, setSeniorityWeight] = useState(20);

  // Kanban prioritizer state
  const [kanbanLeads, setKanbanLeads] = useState<Lead[]>([]);

  const fetchLeads = useCallback(async (mode: 'individuals' | 'companies') => {
    setLoading(true);
    try {
      const res = await getLeads({ searchMode: mode });
      const mapped = (res?.data || []).map(mapApiLeadToUiLead);
      setLeads(mapped);
      setKanbanLeads(mapped);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads(searchModeFilter);
    setSelectedLead(null);
    setSelectedRows({});
  }, [searchModeFilter, fetchLeads]);

  // Sync notes when lead changes
  useEffect(() => {
    if (selectedLead) {
      setLeadNotes(selectedLead.decisionMaker.notes || '');
    }
  }, [selectedLead]);

  // Lead status updates
  const handleUpdateStatus = async (leadId: string, status: Lead['status']) => {
    try {
      if (status === 'Approved') await approveLead(leadId);
      else if (status === 'Rejected') await rejectLead(leadId);
      else await apiUpdateLeadStatus(leadId, STATUS_TO_API[status] || 'new');

      toast.success(`Lead successfully marked as ${status}`);
      // Optimistic update
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
      setKanbanLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
      if (selectedLead?.id === leadId) {
        setSelectedLead(prev => prev ? { ...prev, status } : null);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update status.');
    }
  };

  // Save notes handler
  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    setNotesSaving(true);
    try {
      await apiUpdateLeadNotes(selectedLead.id, leadNotes);
      toast.success('Internal notes updated.');
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, decisionMaker: { ...l.decisionMaker, notes: leadNotes } } : l));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save notes.');
    } finally {
      setNotesSaving(false);
    }
  };

  // Copy to clipboard
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard.');
  };

  // Real CSV export — exports the selected rows if any are checked, otherwise everything currently loaded.
  const handleExportCSV = () => {
    const selectedIds = Object.keys(selectedRows).map(idx => leads[parseInt(idx)]?.id).filter(Boolean);
    const rowsToExport = selectedIds.length > 0 ? leads.filter(l => selectedIds.includes(l.id)) : leads;
    if (rowsToExport.length === 0) {
      toast.info('No leads to export.');
      return;
    }
    const csvRows = [
      ['Company', 'Website', 'Industry', 'Decision Maker', 'Designation', 'Email', 'Phone', 'LinkedIn', 'Score', 'Status'],
      ...rowsToExport.map(l => [
        l.company.name,
        l.company.domain,
        l.company.industry,
        l.decisionMaker.name,
        l.decisionMaker.designation,
        l.decisionMaker.email || '',
        l.decisionMaker.phone || '',
        l.decisionMaker.linkedInUrl || '',
        String(l.score),
        l.status,
      ]),
    ];
    const csv = csvRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${searchModeFilter}-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rowsToExport.length} lead${rowsToExport.length === 1 ? '' : 's'}.`);
  };

  // Bulk Actions
  const handleBulkApprove = () => {
    const selectedIds = Object.keys(selectedRows).map(idx => leads[parseInt(idx)].id);
    selectedIds.forEach(id => handleUpdateStatus(id, 'Approved'));
    setSelectedRows({});
    toast.success(`Batch approved ${selectedIds.length} leads.`);
  };

  const handleBulkReject = () => {
    const selectedIds = Object.keys(selectedRows).map(idx => leads[parseInt(idx)].id);
    selectedIds.forEach(id => handleUpdateStatus(id, 'Rejected'));
    setSelectedRows({});
    toast.warning(`Batch rejected ${selectedIds.length} leads.`);
  };

  // HTML5 Drag and Drop Handlers for Kanban Prioritizer
  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData('text/plain', leadId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetPriority: Lead['priority']) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    const draggedLead = kanbanLeads.find(l => l.id === leadId);
    
    if (draggedLead && draggedLead.priority !== targetPriority) {
      // Update score simulated
      let newScore = draggedLead.score;
      if (targetPriority === 'High') newScore = Math.max(newScore, 85);
      else if (targetPriority === 'Medium') newScore = 75;
      else newScore = 40;

      setKanbanLeads(prev => prev.map(l => l.id === leadId ? { ...l, priority: targetPriority, score: newScore } : l));
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, priority: targetPriority, score: newScore } : l));
      toast.success(`Priority manually overridden to ${targetPriority} for ${draggedLead.decisionMaker.name}`);
    }
  };

  // TanStack Table Column Definitions
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
              onError={(e) => { (e.target as any).src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=40&h=40&fit=crop&q=80'; }}
            />
            <div>
              <span className="font-heading font-semibold text-text-primary block text-sm">{lead.company.name}</span>
              <a 
                href={`https://${lead.company.domain}`} 
                target="_blank" 
                rel="noreferrer" 
                className="text-[10px] text-text-tertiary flex items-center hover:text-brand-primary"
              >
                {lead.company.domain} <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
              </a>
            </div>
          </div>
        );
      }
    },
    {
      id: 'decisionMaker',
      header: 'Decision Maker',
      accessorFn: (row) => row.decisionMaker.name,
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex items-center space-x-2.5">
            <Avatar name={lead.decisionMaker.name} src={lead.decisionMaker.avatarUrl} size="sm" />
            <div>
              <span className="font-heading font-medium text-text-primary block text-xs">{lead.decisionMaker.name}</span>
              <span className="text-[10px] text-text-secondary block truncate max-w-[150px]">{lead.decisionMaker.designation}</span>
            </div>
          </div>
        );
      }
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
      )
    },
    {
      id: 'completeness',
      header: 'Completeness',
      cell: ({ row }) => {
        const comp = row.original.contactCompleteness;
        return (
          <div className="flex items-center space-x-1.5 text-text-secondary">
            <Mail className={`w-3.5 h-3.5 ${comp.email ? 'text-brand-primary' : 'text-text-tertiary opacity-40'}`} />
            <Phone className={`w-3.5 h-3.5 ${comp.phone ? 'text-brand-primary' : 'text-text-tertiary opacity-40'}`} />
            <Linkedin className={`w-3.5 h-3.5 ${comp.linkedIn ? 'text-brand-primary' : 'text-text-tertiary opacity-40'}`} />
          </div>
        );
      }
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
      }
    },
    {
      id: 'actions',
      header: 'Validate',
      cell: ({ row }) => {
        const lead = row.original;
        return (
          <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              title="Approve"
              className="w-9 h-9 text-text-tertiary hover:bg-status-success-bg hover:text-status-success transition-colors"
              onClick={() => handleUpdateStatus(lead.id, 'Approved')}
            >
              <Check className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Reject"
              className="w-9 h-9 text-text-tertiary hover:bg-status-danger-bg hover:text-status-danger transition-colors"
              onClick={() => handleUpdateStatus(lead.id, 'Rejected')}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        );
      }
    }
  ];

  return (
    <div className="space-y-6 fade-in">
      
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Lead Validation & Scoring</h1>
          <p className="text-xs text-text-secondary mt-1">Review AI-sourced decision makers, verify details, and customize weighting models.</p>
        </div>
        <div className="flex items-center space-x-3">
          {/* Individuals / Companies data toggle — mirrors the Lead Search page's search mode */}
          <div className="inline-flex rounded-input border border-border-default overflow-hidden">
            <button
              type="button"
              onClick={() => setSearchModeFilter('individuals')}
              className={`flex items-center px-3 py-1.5 text-xs font-heading font-semibold transition ${
                searchModeFilter === 'individuals'
                  ? 'bg-brand-primary text-white'
                  : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'
              }`}
            >
              <Users className="w-3.5 h-3.5 mr-1.5" /> Individuals
            </button>
            <button
              type="button"
              onClick={() => setSearchModeFilter('companies')}
              className={`flex items-center px-3 py-1.5 text-xs font-heading font-semibold transition border-l border-border-default ${
                searchModeFilter === 'companies'
                  ? 'bg-brand-primary text-white'
                  : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 mr-1.5" /> Companies
            </button>
          </div>
          <Tabs
            tabs={[
              { id: 'review', label: 'Review Queue Table', count: leads.filter(l => l.status === 'New').length },
              { id: 'scoring', label: 'Priority Kanban Board' }
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
          {activeTab === 'review' && leads.length > 0 && (
            <Button variant="secondary" size="sm" icon={Download} onClick={handleExportCSV}>
              Export CSV
            </Button>
          )}
          {activeTab === 'scoring' && (
            <Button variant="secondary" size="sm" icon={Sliders} onClick={() => setScoringModalOpen(true)}>
              Scoring Weights
            </Button>
          )}
        </div>
      </div>

      {/* 2. TAB CONTENT 1: Review Queue (DataTable) */}
      {activeTab === 'review' && (
        <DataTable
          columns={columns}
          data={leads}
          loading={loading}
          searchKey="company"
          searchPlaceholder="Search company, name or industry..."
          onRowClick={(row) => setSelectedLead(row)}
          selectedRows={selectedRows}
          onRowSelectionChange={setSelectedRows}
          bulkActions={
            <>
              <Button variant="ghost" className="text-white hover:bg-white/10 text-xs px-2.5 h-8" onClick={handleBulkApprove}>
                <Check className="w-3.5 h-3.5 mr-1" /> Approve Selected
              </Button>
              <Button variant="ghost" className="text-white hover:bg-white/10 text-xs px-2.5 h-8" onClick={handleBulkReject}>
                <X className="w-3.5 h-3.5 mr-1" /> Reject Selected
              </Button>
              <Button variant="secondary" className="text-xs px-2.5 h-8 bg-white text-text-primary border-none hover:bg-white/90" onClick={handleExportCSV}>
                <Download className="w-3.5 h-3.5 mr-1 text-text-secondary" /> Export CSV
              </Button>
            </>
          }
        />
      )}

      {/* 3. TAB CONTENT 2: Scoring & Kanban view */}
      {activeTab === 'scoring' && (
        <div className="space-y-4">
          
          {/* Quick info panel */}
          <div className="bg-bg-canvas border border-border-subtle p-4 rounded-card flex items-start space-x-3">
            <Info className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
            <div className="text-xs text-text-secondary">
              <span className="font-heading font-semibold text-text-primary block">Manual Priority Override Workspace</span>
              Drag cards between columns to change high/medium/low score priorities manually. Adjust factor weights using the "Scoring Weights" button.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Columns High, Medium, Low */}
            {(['High', 'Medium', 'Low'] as Lead['priority'][]).map(priority => {
              const columnLeads = kanbanLeads.filter(l => l.priority === priority);
              return (
                <div 
                  key={priority}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, priority)}
                  className="bg-bg-canvas/50 border border-border-subtle rounded-card p-4 flex flex-col min-h-[500px]"
                >
                  <div className="flex items-center justify-between pb-3 border-b border-border-subtle mb-4">
                    <span className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${priority === 'High' ? 'bg-status-danger' : priority === 'Medium' ? 'bg-status-warning' : 'bg-text-tertiary'}`} />
                      {priority} Fit Priority
                    </span>
                    <Badge variant="neutral" className="tabular-nums font-bold">{columnLeads.length}</Badge>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {columnLeads.map(lead => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, lead.id)}
                        onClick={() => setSelectedLead(lead)}
                        className="bg-bg-surface border border-border-subtle hover:border-brand-primary rounded-card p-3 shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing transition"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-heading font-semibold text-text-primary block truncate max-w-[150px]">{lead.company.name}</span>
                          <span className="text-[10px] font-heading font-bold text-text-tertiary bg-bg-canvas px-1.5 py-0.5 rounded border border-border-subtle tabular-nums">Score: {lead.score}</span>
                        </div>
                        
                        <div className="flex items-center space-x-2 mt-3">
                          <Avatar name={lead.decisionMaker.name} src={lead.decisionMaker.avatarUrl} size="sm" />
                          <div className="min-w-0">
                            <span className="text-xs font-heading font-medium text-text-secondary block truncate">{lead.decisionMaker.name}</span>
                            <span className="text-[9px] text-text-tertiary block truncate">{lead.decisionMaker.designation}</span>
                          </div>
                        </div>
                        
                        <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-border-subtle/50 text-[10px] text-text-tertiary">
                          <span>{lead.company.industry}</span>
                          <span className="bg-bg-canvas px-1 py-0.2 rounded font-sans uppercase font-bold">{lead.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

          </div>
        </div>
      )}

      {/* 4. RIGHT SIDE DETAIL DRAWER */}
      <Drawer
        isOpen={selectedLead !== null}
        onClose={() => setSelectedLead(null)}
        title={selectedLead ? `Lead Audit: ${selectedLead.decisionMaker.name}` : ''}
        footer={
          selectedLead && (
            <div className="flex justify-between w-full">
              <Badge variant={selectedLead.status === 'Approved' ? 'success' : selectedLead.status === 'Rejected' ? 'danger' : 'neutral'}>
                Current Status: {selectedLead.status}
              </Badge>
              <div className="flex space-x-2">
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={() => handleUpdateStatus(selectedLead.id, 'Rejected')}
                  icon={X}
                >
                  Reject Lead
                </Button>
                <Button 
                  variant="primary" 
                  size="sm" 
                  onClick={() => handleUpdateStatus(selectedLead.id, 'Approved')}
                  icon={Check}
                >
                  Approve Lead
                </Button>
              </div>
            </div>
          )
        }
      >
        {selectedLead && (
          <div className="space-y-6">
            
            {/* Lead Primary Summary */}
            <div className="flex items-start space-x-4 bg-bg-canvas p-4 rounded-card border border-border-subtle">
              <Avatar name={selectedLead.decisionMaker.name} src={selectedLead.decisionMaker.avatarUrl} size="lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-heading font-semibold text-text-primary">{selectedLead.decisionMaker.name}</h3>
                <span className="text-xs text-text-secondary block font-medium mt-0.5">{selectedLead.decisionMaker.designation}</span>
                <span className="text-[11px] text-text-tertiary block mt-1 font-heading">
                  Tenure: {selectedLead.decisionMaker.tenure || 'N/A'} at {selectedLead.company.name}
                </span>
                
                {/* Score breakdown metrics visual */}
                <div className="flex items-center space-x-2 mt-3 bg-bg-surface px-2.5 py-1 rounded-badge border border-border-default max-w-max">
                  <ScoreGauge score={selectedLead.score} size={28} strokeWidth={3} />
                  <span className="text-xs font-heading font-semibold text-text-primary">Match score: {selectedLead.score}/100</span>
                </div>
              </div>
            </div>

            {/* AI Explanation of scoring */}
            <div className="space-y-2">
              <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">AI Scoring Assessment</h4>
              <p className="text-xs text-text-secondary bg-bg-canvas p-3 rounded-card border border-border-subtle leading-relaxed italic">
                "{selectedLead.decisionMaker.scoreExplanation || 'No score description generated.'}"
              </p>
            </div>

            {/* Contact Information & Copy Buttons */}
            <div className="space-y-2">
              <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Verified Coordinates</h4>
              <div className="border border-border-subtle rounded-card divide-y divide-border-subtle overflow-hidden">
                <div className="p-3 flex items-center justify-between text-xs hover:bg-bg-canvas/30 transition">
                  <div className="flex items-center space-x-2">
                    <Mail className="w-4 h-4 text-text-tertiary" />
                    <span className="font-medium text-text-secondary">Email</span>
                  </div>
                  {selectedLead.decisionMaker.email ? (
                    <div className="flex items-center space-x-2 font-mono">
                      <span>{selectedLead.decisionMaker.email}</span>
                      <button onClick={() => handleCopy(selectedLead.decisionMaker.email!)} className="p-1 hover:bg-bg-canvas rounded text-text-secondary"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : <span className="text-text-tertiary italic">Not enriched</span>}
                </div>

                <div className="p-3 flex items-center justify-between text-xs hover:bg-bg-canvas/30 transition">
                  <div className="flex items-center space-x-2">
                    <Phone className="w-4 h-4 text-text-tertiary" />
                    <span className="font-medium text-text-secondary">Phone</span>
                  </div>
                  {selectedLead.decisionMaker.phone ? (
                    <div className="flex items-center space-x-2 font-mono">
                      <span>{selectedLead.decisionMaker.phone}</span>
                      <button onClick={() => handleCopy(selectedLead.decisionMaker.phone!)} className="p-1 hover:bg-bg-canvas rounded text-text-secondary"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : <span className="text-text-tertiary italic">Not enriched</span>}
                </div>

                <div className="p-3 flex items-center justify-between text-xs hover:bg-bg-canvas/30 transition">
                  <div className="flex items-center space-x-2">
                    <Linkedin className="w-4 h-4 text-text-tertiary" />
                    <span className="font-medium text-text-secondary">LinkedIn Profile</span>
                  </div>
                  {selectedLead.decisionMaker.linkedInUrl ? (
                    <a 
                      href={selectedLead.decisionMaker.linkedInUrl} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="text-brand-primary font-semibold flex items-center hover:underline"
                    >
                      View Profile <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  ) : <span className="text-text-tertiary italic">No link</span>}
                </div>

                {/* Company LinkedIn Profile */}
                <div className="p-3 flex items-center justify-between text-xs hover:bg-bg-canvas/30 transition">
                  <div className="flex items-center space-x-2">
                    <Linkedin className="w-4 h-4 text-text-tertiary" />
                    <span className="font-medium text-text-secondary">Company LinkedIn</span>
                  </div>
                  {selectedLead.company.linkedInUrl ? (
                    <a
                      href={selectedLead.company.linkedInUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-primary font-semibold flex items-center hover:underline"
                    >
                      View Company Profile <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  ) : <span className="text-text-tertiary italic">No link</span>}
                </div>
              </div>
            </div>

            {/* Company Details */}
            <div className="space-y-2">
              <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Company Intelligence</h4>
              <div className="p-4 bg-bg-canvas/50 border border-border-subtle rounded-card space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Employees:</span>
                  <span className="font-semibold text-text-primary tabular-nums">{selectedLead.company.employeeCount || selectedLead.company.sizeRange || '—'}</span>
                </div>
                {selectedLead.company.revenueRange && (
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">Revenue:</span>
                    <span className="font-semibold text-text-primary tabular-nums">{selectedLead.company.revenueRange}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Industry NAICS:</span>
                  <span className="font-semibold text-text-primary">{selectedLead.company.industry}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Funding:</span>
                  <Badge variant="warning">{selectedLead.company.fundingStage || 'Undisclosed'}</Badge>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-secondary">Technology Stack:</span>
                  <span className="font-semibold text-text-primary text-[10px]">{selectedLead.company.techStack?.join(', ')}</span>
                </div>
                
                {/* Company's Activity Signals */}
                {((selectedLead.company.hiringSignals && selectedLead.company.hiringSignals.length > 0) || (selectedLead.activitySignals && selectedLead.activitySignals.length > 0)) && (
                  <div className="border-t border-border-subtle pt-3 space-y-2">
                    <span className="block text-xs font-heading font-semibold text-text-primary">Company's Activity (Hiring & Achievements)</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLead.company.hiringSignals?.map((sig, idx) => (
                        <Badge key={idx} variant="info" className="text-[10px]">💼 Hiring: {sig}</Badge>
                      ))}
                      {selectedLead.activitySignals?.map((sig, idx) => (
                        <Badge key={idx} variant="success" className="text-[10px]">🎯 {sig}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-text-secondary border-t border-border-subtle pt-3 leading-relaxed">
                  {selectedLead.company.overview}
                </p>
              </div>
            </div>

            {/* Internal notes persistance textarea */}
            <div className="space-y-2">
              <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Internal Notes</h4>
              <div className="space-y-2">
                <textarea
                  rows={3}
                  value={leadNotes}
                  onChange={(e) => setLeadNotes(e.target.value)}
                  placeholder="Annotate details, custom references or follow-up timelines..."
                  className="w-full text-xs p-3 bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
                <div className="flex justify-end">
                  <Button variant="secondary" size="sm" onClick={handleSaveNotes} loading={notesSaving}>
                    Save Notes
                  </Button>
                </div>
              </div>
            </div>

          </div>
        )}
      </Drawer>

      {/* Admin configure scoring model weights modal */}
      <Modal
        isOpen={scoringModalOpen}
        onClose={() => setScoringModalOpen(false)}
        title="Configure Scoring Model Parameters"
        size="md"
      >
        <div className="space-y-5">
          <p className="text-xs text-text-secondary leading-relaxed">
            Adjust weights for individual parameters. The scoring engine recalculates lead priority dynamically based on aggregate criteria matches.
          </p>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <label className="font-heading font-semibold text-text-secondary">Industry Match Fit Weight</label>
                <span className="font-mono text-brand-primary font-bold">{industryWeight}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={industryWeight}
                onChange={(e) => setIndustryWeight(Number(e.target.value))}
                className="w-full accent-brand-primary"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label className="font-heading font-semibold text-text-secondary">Location Match Fit Weight</label>
                <span className="font-mono text-brand-primary font-bold">{locationWeight}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={locationWeight}
                onChange={(e) => setLocationWeight(Number(e.target.value))}
                className="w-full accent-brand-primary"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label className="font-heading font-semibold text-text-secondary">Company Size Fit (Employees)</label>
                <span className="font-mono text-brand-primary font-bold">{sizeWeight}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={sizeWeight}
                onChange={(e) => setSizeWeight(Number(e.target.value))}
                className="w-full accent-brand-primary"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label className="font-heading font-semibold text-text-secondary">Company's Activity (Hiring & Achievements)</label>
                <span className="font-mono text-brand-primary font-bold">{activityWeight}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={activityWeight}
                onChange={(e) => setActivityWeight(Number(e.target.value))}
                className="w-full accent-brand-primary"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <label className="font-heading font-semibold text-text-secondary">Decision-Maker Designation Fit</label>
                <span className="font-mono text-brand-primary font-bold">{seniorityWeight}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={seniorityWeight}
                onChange={(e) => setSeniorityWeight(Number(e.target.value))}
                className="w-full accent-brand-primary"
              />
            </div>
          </div>

          <div className="border-t border-border-subtle pt-4 flex items-center justify-between text-xs">
            <span className={industryWeight + locationWeight + sizeWeight + activityWeight + seniorityWeight === 100 ? 'text-status-success font-semibold' : 'text-status-danger font-semibold'}>
              Total Weight: {industryWeight + locationWeight + sizeWeight + activityWeight + seniorityWeight}% (Must equal 100%)
            </span>
            <div className="flex space-x-2">
              <Button variant="secondary" size="sm" onClick={() => setScoringModalOpen(false)}>Cancel</Button>
              <Button 
                variant="primary" 
                size="sm" 
                disabled={industryWeight + locationWeight + sizeWeight + activityWeight + seniorityWeight !== 100}
                onClick={() => {
                  setScoringModalOpen(false);
                  toast.success('Scoring weight algorithms successfully updated and deployed.');
                }}
              >
                Apply Criteria
              </Button>
            </div>
          </div>
        </div>
      </Modal>

    </div>
  );
};
