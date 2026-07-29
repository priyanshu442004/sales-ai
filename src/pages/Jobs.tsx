import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Card, Badge, Modal } from '../components/ui/core';
import {
  RefreshCw, XCircle, CheckCircle2, AlertCircle, Cpu, Loader2, User, Clock, Download, Trash2,
  ExternalLink, Linkedin, Filter, X as XIcon, Mail, Send, CalendarClock, Play, Ban
} from 'lucide-react';
import { toast } from 'sonner';
import { cancelJob, cancelSearchSchedule, deleteJob, getJob, getLeadsForJob, listJobs, listSearches, rerunJob, runSearch } from '../services/sourcingApi';
import { EmailComposeModal } from '../components/EmailComposeModal';
import type { EmailRecipient } from '../components/EmailComposeModal';
import { LeadPickerModal } from '../components/LeadPickerModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { buildCSVRows, downloadCSVRows } from '../utils/csvExport';

interface JobProgress { scraped: number; target: number; }
interface JobParameters {
  countries: string[];
  states: string[];
  cities: string[];
  industries: string[];
  titles: string[];
  limit: number;
  sizeRange: (number | null)[];
  revenueBands: string[];
  advancedFilters?: {
    proactive_keywords?: string[];
    proactive_filter?: string;
    [key: string]: any;
  };
}

type JobStatus = 'Queued' | 'Running' | 'Completed' | 'Partial' | 'Failed';

interface LiveJob {
  id: string;
  search_id?: string;
  name: string;
  status: JobStatus;
  searchMode: 'individuals' | 'companies' | 'proactive';
  startedAt: string;
  completedAt?: string;
  duration?: string;
  triggeredBy: string;
  logs: string[];
  errors?: string;
  leadsFound: number;
  parameters: JobParameters;
  progress: JobProgress;
}

interface ScrapedLead {
  id: string;
  score: number | null;
  company: { name: string; industry: string; website?: string; linkedinUrl?: string; overview?: string };
  decisionMaker: { full_name: string; designation: string; email?: string; phone?: string; linkedin_url?: string };
  activitySignals: string[];
}

function StatusBadge({ status }: { status: LiveJob['status'] }) {
  switch (status) {
    case 'Completed':
      return <Badge variant="success"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Completed</Badge>;
    case 'Partial':
      return <Badge variant="warning"><AlertCircle className="w-3.5 h-3.5 mr-1" /> Partial</Badge>;
    case 'Running':
      return <Badge variant="info"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Running</Badge>;
    case 'Queued':
      return <Badge variant="neutral"><Clock className="w-3.5 h-3.5 mr-1" /> Queued</Badge>;
    case 'Failed':
      return <Badge variant="danger"><AlertCircle className="w-3.5 h-3.5 mr-1" /> Failed</Badge>;
    default:
      return <Badge variant="warning">{status}</Badge>;
  }
}

const ALL_STATUSES: JobStatus[] = ['Queued', 'Running', 'Completed', 'Partial', 'Failed'];

interface ScheduledSearch {
  id: string;
  name: string;
  search_mode: 'individuals' | 'companies' | 'proactive';
  countries: string[];
  industries: string[];
  designations: string[];
  schedule: { type?: string; datetime?: string; executed?: boolean; recurrence?: string };
}

export const Jobs: React.FC = () => {
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [scheduledSearches, setScheduledSearches] = useState<ScheduledSearch[]>([]);
  const [scheduleWorkingId, setScheduleWorkingId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<LiveJob | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scrapedLeads, setScrapedLeads] = useState<ScrapedLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<Set<JobStatus>>(new Set());
  const [modeFilter, setModeFilter] = useState<'all' | 'individuals' | 'companies' | 'proactive'>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Multi-select for bulk actions
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  // Lead-level selection inside the job detail modal, for sending emails
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeRecipients, setComposeRecipients] = useState<EmailRecipient[]>([]);

  // Page-level compose — reaches any lead across every job, not just the
  // one currently open in the detail modal.
  const [pickerOpen, setPickerOpen] = useState(false);

  // In-app replacement for window.confirm() — holds whatever destructive
  // action is pending confirmation, run only if the user clicks through.
  const [confirmAction, setConfirmAction] = useState<{ message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  // ─── Fetch jobs list ───────────────────────────────────────────────────────
  const fetchJobs = useCallback(async (silent = false) => {
    try {
      const data = await listJobs();
      const normalized = (data?.data || []).map((job: any) => ({
        ...job,
        status: job.status || 'Queued',
        searchMode: job.searchMode === 'proactive' ? 'proactive' : job.searchMode === 'companies' ? 'companies' : 'individuals',
        startedAt: job.startedAt || new Date().toISOString(),
        duration: job.duration || null,
        logs: Array.isArray(job.logs) ? job.logs : [],
        leadsFound: Number(job.leadsFound || job.progress?.scraped || 0),
        parameters: {
          countries: job.parameters?.countries || [],
          states: job.parameters?.states || [],
          cities: job.parameters?.cities || [],
          industries: job.parameters?.industries || [],
          titles: job.parameters?.titles || [],
          limit: Number(job.parameters?.limit || 50),
          sizeRange: job.parameters?.sizeRange || [null, null],
          revenueBands: job.parameters?.revenueBands || [],
          advancedFilters: job.parameters?.advancedFilters || {},
        },
        progress: {
          scraped: Number(job.progress?.scraped || job.leadsFound || 0),
          target: Number(job.progress?.target || job.parameters?.limit || 50),
        },
      }));
      setJobs(normalized);
    } catch (e: any) {
      if (!silent) console.error('Failed to load jobs:', e.message);
    }
  }, []);

  // ─── Fetch scheduled (not-yet-run) searches ────────────────────────────────
  const fetchScheduledSearches = useCallback(async (silent = false) => {
    try {
      const data = await listSearches();
      setScheduledSearches((data || []).filter((s: any) => {
        const sch = s.schedule || {};
        if (sch.type === 'recurring') return !!sch.recurrence;
        if (sch.type === 'one-time') return !!sch.datetime && !sch.executed;
        return false;
      }));
    } catch (e: any) {
      if (!silent) console.error('Failed to load scheduled searches:', e.message);
    }
  }, []);

  // Initial load (fires every time this page mounts, i.e. every time the
  // user navigates here) + polling every 5s while it stays open.
  useEffect(() => {
    setInitialLoading(true);
    Promise.allSettled([fetchJobs(), fetchScheduledSearches()]).finally(() => setInitialLoading(false));
    const interval = setInterval(() => {
      fetchJobs(true);
      fetchScheduledSearches(true);
    }, 5000);

    // Also refresh immediately when the user tabs back into the browser
    // instead of waiting up to 5s for the next poll tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') { fetchJobs(true); fetchScheduledSearches(true); }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchJobs, fetchScheduledSearches]);

  // A scheduled search that already has a Queued/Running job in the queue
  // has effectively "started" — hide it from the Scheduled section so it
  // only ever shows in one place at a time (it reappears here once that
  // run finishes, for recurring schedules with a next occurrence).
  const activeSearchIds = useMemo(
    () => new Set(jobs.filter(j => j.status === 'Queued' || j.status === 'Running').map(j => j.search_id).filter(Boolean)),
    [jobs]
  );
  const visibleScheduledSearches = useMemo(
    () => scheduledSearches.filter(s => !activeSearchIds.has(s.id)),
    [scheduledSearches, activeSearchIds]
  );

  const scheduleLabel = (sch: ScheduledSearch['schedule']) => {
    if (sch.type === 'one-time' && sch.datetime) {
      return `Runs once on ${new Date(sch.datetime).toLocaleString()}`;
    }
    if (sch.type === 'recurring' && sch.recurrence) {
      return `Repeats ${sch.recurrence}`;
    }
    return 'Not scheduled';
  };

  const handleRunScheduledNow = async (s: ScheduledSearch) => {
    setScheduleWorkingId(s.id);
    try {
      await runSearch(s.id);
      toast.success(`"${s.name}" queued — see it below in the queue.`);
      fetchJobs();
      fetchScheduledSearches();
    } catch (e: any) {
      toast.error(e.message || 'Failed to run scheduled search.');
    } finally {
      setScheduleWorkingId(null);
    }
  };

  const handleCancelSchedule = (s: ScheduledSearch) => {
    setConfirmAction({
      message: `Cancel the schedule for "${s.name}"? The target parameters stay saved — only the automatic run is cancelled.`,
      confirmLabel: 'Cancel Schedule',
      onConfirm: async () => {
        setConfirmAction(null);
        setScheduleWorkingId(s.id);
        try {
          await cancelSearchSchedule(s.id);
          toast.success('Schedule cancelled.');
          fetchScheduledSearches();
        } catch (e: any) {
          toast.error(e.message || 'Failed to cancel schedule.');
        } finally {
          setScheduleWorkingId(null);
        }
      },
    });
  };

  // Sync selectedJob when jobs list updates
  useEffect(() => {
    if (!selectedJob) return;
    const updated = jobs.find(j => j.id === selectedJob.id);
    if (updated) setSelectedJob(updated);
  }, [jobs]); // eslint-disable-line

  // ─── SSE Log Streaming ────────────────────────────────────────────────────
  const startLogStream = useCallback((jobId: string) => {
    // Close existing stream
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    // EventSource doesn't support custom headers, so we pass token as query param.
    // The app uses polling via fetch instead for auth-compatible log updates.
    setLogLines([]);

    // Use fetch-based streaming (compatible with auth)
    let isCancelled = false;
    let lastIdx = 0;

    const pollLogs = async () => {
      while (!isCancelled) {
        try {
          const job = await getJob(jobId);
          const currentLogs = job.logs || [];
          if (currentLogs.length > lastIdx) {
            setLogLines([...currentLogs]);
            lastIdx = currentLogs.length;
            // Auto-scroll
            setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          }
          if (job.status === 'Completed' || job.status === 'Partial' || job.status === 'Failed') {
            setSelectedJob(job);
            fetchJobs(true);
            break;
          }
        } catch {
          // silently retry
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    };

    pollLogs();

    return () => { isCancelled = true; };
  }, [fetchJobs]);

  // When a job is selected, set its current logs and start live polling if active
  useEffect(() => {
    setSelectedLeadIds(new Set());
    if (!selectedJob) {
      setLogLines([]);
      setScrapedLeads([]);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      return;
    }

    setLogLines(selectedJob.logs || []);

    if (selectedJob.status === 'Running' || selectedJob.status === 'Queued') {
      const cancel = startLogStream(selectedJob.id);
      return cancel;
    }

    if (selectedJob.status === 'Completed' || selectedJob.status === 'Partial') {
      loadLeadsForJob(selectedJob.id);
    }
  }, [selectedJob?.id, selectedJob?.status]); // eslint-disable-line

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  // ─── Load scraped leads for completed job ─────────────────────────────────
  const mapLeadsResponse = (data: any): ScrapedLead[] =>
    (data?.data || []).map((lead: any) => ({
      id: lead.id,
      score: lead.score === null || lead.score === undefined ? null : Number(lead.score),
      company: {
        name: lead.company?.name || 'Unknown company',
        industry: lead.company?.industry || 'Not available',
        website: lead.company?.website || lead.company?.domain || '',
        linkedinUrl: lead.company?.linkedin_url || '',
        overview: lead.company?.overview || '',
      },
      decisionMaker: {
        full_name: lead.decisionMaker?.full_name || lead.decisionMaker?.name || 'Unknown contact',
        designation: lead.decisionMaker?.designation || '—',
        email: lead.decisionMaker?.email || '',
        phone: lead.decisionMaker?.phone || '',
        linkedin_url: lead.decisionMaker?.linkedin_url || '',
      },
      activitySignals: Array.isArray(lead.activitySignals) ? lead.activitySignals : [],
    }));

  const loadLeadsForJob = async (jobId: string) => {
    setLoadingLeads(true);
    setScrapedLeads([]);
    try {
      const data = await getLeadsForJob(jobId);
      const mapped = mapLeadsResponse(data);
      setScrapedLeads(mapped);
      if (mapped.length === 0) {
        console.warn('No leads found for job', jobId);
      }
    } catch (e: any) {
      console.error('Failed to load job leads:', e.message);
      toast.error('Could not load scraped contacts for this job.');
    } finally {
      setLoadingLeads(false);
    }
  };

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchJobs();
    setIsRefreshing(false);
    toast.success('Jobs queue refreshed.');
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelJob(jobId);
      toast.success('Scrape job cancelled successfully.');
      fetchJobs();
      if (selectedJob?.id === jobId) {
        setSelectedJob(prev => prev ? { ...prev, status: 'Failed', errors: 'Cancelled by user.' } : null);
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to cancel job.');
    }
  };

  const handleReRunJob = async (job: LiveJob) => {
    try {
      toast.info(`Re-queuing search: ${job.name}`);
      await rerunJob(job);
      toast.success('Job queued in Jobs Queue.');
      fetchJobs();
    } catch (e: any) {
      toast.error(e.message || 'Failed to re-run job.');
    }
  };

  const exportLeadsCSV = () => {
    if (!scrapedLeads.length || !selectedJob) return;
    downloadCSVRows(
      buildCSVRows(scrapedLeads, selectedJob.searchMode),
      `${selectedJob.searchMode}-${selectedJob.id.slice(0, 8)}.csv`
    );
  };

  // ─── Lead-level selection + cold email send (inside the job detail modal) ──
  const toggleLeadSelected = (leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };

  const allLeadsSelected = scrapedLeads.length > 0 && scrapedLeads.every((l) => selectedLeadIds.has(l.id));

  const toggleSelectAllLeads = () => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (allLeadsSelected) {
        scrapedLeads.forEach((l) => next.delete(l.id));
      } else {
        scrapedLeads.forEach((l) => next.add(l.id));
      }
      return next;
    });
  };

  const leadToRecipient = (lead: ScrapedLead): EmailRecipient => ({
    id: lead.id,
    name: lead.decisionMaker.full_name,
    email: lead.decisionMaker.email || undefined,
    company: lead.company.name,
    title: lead.decisionMaker.designation || undefined,
  });

  const openComposeForSelected = () => {
    const targets = scrapedLeads.filter((l) => selectedLeadIds.has(l.id));
    setComposeRecipients(targets.map(leadToRecipient));
    setComposeOpen(true);
  };

  const openComposeForOne = (lead: ScrapedLead) => {
    setComposeRecipients([leadToRecipient(lead)]);
    setComposeOpen(true);
  };

  const handlePickerContinue = (recipients: EmailRecipient[]) => {
    setPickerOpen(false);
    setComposeRecipients(recipients);
    setComposeOpen(true);
  };

  const handleExportJob = async (job: LiveJob) => {
    try {
      const data = await getLeadsForJob(job.id);
      const leads = mapLeadsResponse(data);
      if (leads.length === 0) {
        toast.info('This job has no saved contacts to export yet.');
        return;
      }
      downloadCSVRows(buildCSVRows(leads, job.searchMode), `${job.searchMode}-${job.id.slice(0, 8)}.csv`);
      toast.success('Leads exported.');
    } catch (e: any) {
      toast.error(e.message || 'Failed to export leads for this job.');
    }
  };

  // ─── Filtering ───────────────────────────────────────────────────────────
  const toggleStatusFilter = (status: JobStatus) => {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  const filteredJobs = useMemo(() => jobs.filter(job => {
    if (statusFilter.size > 0 && !statusFilter.has(job.status)) return false;
    if (modeFilter !== 'all' && job.searchMode !== modeFilter) return false;
    return true;
  }), [jobs, statusFilter, modeFilter]);

  const activeFilterCount = statusFilter.size + (modeFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setStatusFilter(new Set());
    setModeFilter('all');
  };

  // ─── Multi-select ────────────────────────────────────────────────────────
  const toggleJobSelected = (jobId: string) => {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  };

  const allVisibleSelected = filteredJobs.length > 0 && filteredJobs.every(j => selectedJobIds.has(j.id));

  const toggleSelectAllVisible = () => {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredJobs.forEach(j => next.delete(j.id));
      } else {
        filteredJobs.forEach(j => next.add(j.id));
      }
      return next;
    });
  };

  // ─── Bulk actions ────────────────────────────────────────────────────────
  const selectedJobs = jobs.filter(j => selectedJobIds.has(j.id));

  const handleBulkDelete = () => {
    const blocked = selectedJobs.filter(j => j.status === 'Running' || j.status === 'Queued');
    if (blocked.length > 0) {
      toast.error(`Cancel ${blocked.length} running/queued job${blocked.length > 1 ? 's' : ''} before deleting.`);
      return;
    }
    setConfirmAction({
      message: `Delete ${selectedJobs.length} job(s)? This also removes their saved leads and can't be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmAction(null);
        setBulkWorking(true);
        try {
          const results = await Promise.allSettled(selectedJobs.map(j => deleteJob(j.id)));
          const failed = results.filter(r => r.status === 'rejected').length;
          if (failed > 0) toast.error(`${failed} job(s) failed to delete.`);
          if (failed < selectedJobs.length) toast.success(`Deleted ${selectedJobs.length - failed} job(s).`);
          setSelectedJobIds(new Set());
          fetchJobs();
        } finally {
          setBulkWorking(false);
        }
      },
    });
  };

  const handleBulkRerun = async () => {
    setBulkWorking(true);
    try {
      const results = await Promise.allSettled(selectedJobs.map(j => rerunJob(j)));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) toast.error(`${failed} job(s) failed to re-run.`);
      if (failed < selectedJobs.length) toast.success(`Re-queued ${selectedJobs.length - failed} job(s).`);
      setSelectedJobIds(new Set());
      fetchJobs();
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkExport = async () => {
    const exportable = selectedJobs.filter(j => j.status === 'Completed' || j.status === 'Partial');
    if (exportable.length === 0) {
      toast.info('None of the selected jobs have completed results to export.');
      return;
    }
    setBulkWorking(true);
    try {
      const perJob = await Promise.all(exportable.map(async job => ({
        job,
        leads: mapLeadsResponse(await getLeadsForJob(job.id)),
      })));

      // Kept in separate sheets by design — individuals and companies carry
      // different fields, so mixing them into one CSV would either mangle
      // columns or force blank cells either way.
      const individualLeads = perJob.filter(x => x.job.searchMode === 'individuals').flatMap(x => x.leads);
      const companyLeads = perJob.filter(x => x.job.searchMode === 'companies').flatMap(x => x.leads);

      let filesExported = 0;
      const stamp = new Date().toISOString().slice(0, 10);
      if (individualLeads.length > 0) {
        downloadCSVRows(buildCSVRows(individualLeads, 'individuals'), `individuals-${stamp}.csv`);
        filesExported++;
      }
      if (companyLeads.length > 0) {
        downloadCSVRows(buildCSVRows(companyLeads, 'companies'), `companies-${stamp}.csv`);
        filesExported++;
      }

      if (filesExported === 0) {
        toast.info('No leads found in the selected jobs.');
      } else {
        toast.success(`Exported ${individualLeads.length} individual lead(s) and ${companyLeads.length} compan${companyLeads.length === 1 ? 'y' : 'ies'} into separate sheets.`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Bulk export failed.');
    } finally {
      setBulkWorking(false);
    }
  };

  const handleDeleteJob = (job: LiveJob) => {
    if (job.status === 'Running' || job.status === 'Queued') {
      toast.error('Cancel this job before deleting it.');
      return;
    }
    setConfirmAction({
      message: `Delete "${job.name}"? This also removes its saved leads and can't be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setConfirmAction(null);
        try {
          await deleteJob(job.id);
          toast.success('Job deleted.');
          if (selectedJob?.id === job.id) setSelectedJob(null);
          fetchJobs();
        } catch (e: any) {
          toast.error(e.message || 'Failed to delete job.');
        }
      },
    });
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Job Queue</h1>
          <p className="text-xs text-text-secondary mt-1">
            See the status of every search, watch its progress, and view the leads it finds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4 mr-2" /> Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 bg-brand-primary text-white text-[10px] font-bold rounded-full w-4 h-4 inline-flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button variant="secondary" onClick={handleRefresh} loading={isRefreshing}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button variant="primary" onClick={() => setPickerOpen(true)}>
            <Mail className="w-4 h-4 mr-2" /> Compose email
          </Button>
        </div>
      </div>

      {/* Scheduled Searches — separate from the live queue below. A search
          drops out of this section the moment it actually starts running
          (it shows up in the queue table instead), and reappears here once
          that run finishes if it's a recurring schedule with a next
          occurrence still ahead. */}
      {visibleScheduledSearches.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border-subtle flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-brand-primary" />
            <h3 className="text-sm font-heading font-bold text-text-primary">Scheduled</h3>
            <span className="text-[10px] text-text-tertiary font-medium">({visibleScheduledSearches.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-bg-canvas border-b border-border-default text-xs font-heading font-semibold uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="p-4">Search Name</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Target Criteria</th>
                  <th className="p-4">Schedule</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-xs">
                {visibleScheduledSearches.map((s) => (
                  <tr key={s.id} className="hover:bg-bg-canvas/50 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-brand-primary/5 text-brand-primary rounded-btn">
                          <CalendarClock className="w-4 h-4" />
                        </div>
                        <span className="font-heading font-semibold text-text-primary block text-sm">{s.name}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={s.search_mode === 'proactive' ? 'accent' : s.search_mode === 'companies' ? 'info' : 'neutral'} className="capitalize">
                        {s.search_mode === 'proactive' ? 'Proactive' : s.search_mode}
                      </Badge>
                    </td>
                    <td className="p-4 text-text-secondary">
                      {s.search_mode === 'proactive' ? (
                        <>
                          <span className="block truncate max-w-xs font-medium text-text-primary">
                            {(s.countries || []).join(' · ') || 'Global'}
                          </span>
                          <span className="text-[10px] text-text-tertiary block mt-0.5">
                            Keywords: {s.name.includes(': ') ? s.name.split(': ')[1].split(' [')[0] : 'Proactive Intent'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block truncate max-w-xs">
                            {[...(s.countries || []), ...(s.industries || [])].filter(Boolean).join(' · ') || '—'}
                          </span>
                          <span className="text-[10px] text-text-tertiary block mt-0.5">
                            {(s.designations || []).join(', ') || '—'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="p-4 text-text-secondary font-heading">{scheduleLabel(s.schedule)}</td>
                    <td className="p-4 text-right space-x-1.5">
                      <Button
                        variant="ghost" size="sm" className="px-2 h-8" title="Run now"
                        disabled={scheduleWorkingId === s.id}
                        onClick={() => handleRunScheduledNow(s)}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="px-2 h-8 text-status-danger" title="Cancel schedule"
                        disabled={scheduleWorkingId === s.id}
                        onClick={() => handleCancelSchedule(s)}
                      >
                        <Ban className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Filter panel */}
      {showFilters && (
        <Card className="p-4 space-y-3">
          <div>
            <span className="block text-[10px] font-heading font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map(status => {
                const active = statusFilter.has(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleStatusFilter(status)}
                    className={`text-xs px-2.5 py-1 rounded-badge border transition ${
                      active
                        ? 'bg-brand-primary text-white border-brand-primary font-medium'
                        : 'bg-bg-surface hover:bg-bg-canvas text-text-secondary border-border-default'
                    }`}
                  >
                    {status}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <span className="block text-[10px] font-heading font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Search type</span>
            <div className="inline-flex rounded-input border border-border-default overflow-hidden">
              {(['all', 'individuals', 'companies', 'proactive'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setModeFilter(mode)}
                  className={`px-3 py-1.5 text-xs font-heading font-semibold capitalize transition border-r border-border-default last:border-r-0 ${
                    modeFilter === mode
                      ? 'bg-brand-primary text-white'
                      : 'bg-bg-surface text-text-secondary hover:bg-bg-canvas'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="text-xs text-brand-primary hover:underline font-heading font-medium">
              Clear all filters
            </button>
          )}
        </Card>
      )}

      {/* Bulk action bar */}
      {selectedJobIds.size > 0 && (
        <div className="flex items-center justify-between bg-brand-primary text-white rounded-card px-4 py-2.5">
          <span className="text-xs font-heading font-semibold">
            {selectedJobIds.size} job{selectedJobIds.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-xs px-2.5 h-8" onClick={handleBulkExport} disabled={bulkWorking}>
              <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
            </Button>
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-xs px-2.5 h-8" onClick={handleBulkRerun} disabled={bulkWorking}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-run
            </Button>
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-xs px-2.5 h-8" onClick={handleBulkDelete} disabled={bulkWorking}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
            </Button>
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10 text-xs px-2 h-8" onClick={() => setSelectedJobIds(new Set())}>
              <XIcon className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Loading state — must come before the "No Searches Yet" empty state,
          otherwise that empty state flashes on every load (jobs.length is
          legitimately 0 before the first fetch resolves too). */}
      {initialLoading && (
        <Card className="text-center py-16">
          <Loader2 className="w-8 h-8 text-text-tertiary mx-auto animate-spin" />
          <p className="text-xs text-text-secondary mt-3">Loading jobs...</p>
        </Card>
      )}

      {/* Empty state */}
      {!initialLoading && jobs.length === 0 && visibleScheduledSearches.length === 0 && (
        <Card className="text-center py-16">
          <Cpu className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
          <h3 className="text-base font-heading font-semibold text-text-primary">No Searches Yet</h3>
          <p className="text-xs text-text-secondary mt-1">
            Go to <strong>Lead Search</strong> and click <strong>Scrape Now</strong> to run your first search.
          </p>
        </Card>
      )}

      {/* No matches for current filters */}
      {!initialLoading && jobs.length > 0 && filteredJobs.length === 0 && (
        <Card className="text-center py-16">
          <Filter className="w-10 h-10 text-text-tertiary mx-auto mb-4" />
          <h3 className="text-base font-heading font-semibold text-text-primary">No jobs match these filters</h3>
          <button type="button" onClick={clearFilters} className="text-xs text-brand-primary hover:underline font-heading font-medium mt-2">
            Clear filters
          </button>
        </Card>
      )}

      {/* Jobs Table */}
      {filteredJobs.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-bg-canvas border-b border-border-default text-xs font-heading font-semibold uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="p-4 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                    />
                  </th>
                  <th className="p-4">Job Name</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Target Criteria</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Leads Found</th>
                  <th className="p-4">Started</th>
                  <th className="p-4">Duration</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-xs">
                {filteredJobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => setSelectedJob(job)}
                    className={`hover:bg-bg-canvas/50 cursor-pointer transition-colors ${selectedJobIds.has(job.id) ? 'bg-brand-primary/[0.04]' : ''}`}
                  >
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedJobIds.has(job.id)}
                        onChange={() => toggleJobSelected(job.id)}
                        className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-brand-primary/5 text-brand-primary rounded-btn">
                          <Cpu className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-heading font-semibold text-text-primary block text-sm">{job.name}</span>
                          <span className="text-[10px] text-text-tertiary font-mono">ID: {job.id.slice(0, 12)}...</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={job.searchMode === 'proactive' ? 'accent' : job.searchMode === 'companies' ? 'info' : 'neutral'} className="capitalize">
                        {job.searchMode === 'proactive' ? 'Proactive' : job.searchMode}
                      </Badge>
                    </td>
                    <td className="p-4 text-text-secondary">
                      {job.searchMode === 'proactive' ? (
                        <>
                          <span className="block truncate max-w-xs font-medium text-text-primary">
                            {(job.parameters?.countries || []).join(' · ') || 'Global'}
                          </span>
                          <span className="text-[10px] text-text-tertiary block mt-0.5">
                            Keywords: {job.parameters?.advancedFilters?.proactive_keywords?.length 
                              ? job.parameters.advancedFilters.proactive_keywords.join(', ') 
                              : (job.name.includes(': ') ? job.name.split(': ')[1].split(' [')[0] : 'Proactive Intent')}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block truncate max-w-xs">
                            {[...(job.parameters?.countries || []), ...(job.parameters?.industries || [])].filter(Boolean).join(' · ') || '—'}
                          </span>
                          <span className="text-[10px] text-text-tertiary block mt-0.5">
                            {(job.parameters?.titles || []).join(', ') || '—'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="p-4"><StatusBadge status={job.status} /></td>
                    <td className="p-4">
                      <div className="w-28">
                        <div className="flex justify-between text-[10px] font-heading font-semibold text-text-secondary mb-1">
                          <span>{job.leadsFound} / {job.parameters?.limit || 50}</span>
                          <span>{Math.max(0, Math.min(100, Math.round((job.leadsFound / Math.max(1, job.parameters?.limit || 50)) * 100)))}%</span>
                        </div>
                        <div className="w-full bg-border-subtle h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${job.status === 'Failed' ? 'bg-status-danger' : job.status === 'Partial' ? 'bg-status-warning' : 'bg-brand-primary'}`}
                            style={{ width: `${Math.max(0, Math.min(100, (job.leadsFound / Math.max(1, job.parameters?.limit || 50)) * 100))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-text-secondary">
                      {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '—'}
                      <span className="block text-[10px] text-text-tertiary mt-0.5">{job.startedAt ? new Date(job.startedAt).toLocaleDateString() : '—'}</span>
                    </td>
                    <td className="p-4 text-text-secondary font-heading">{job.duration || (job.status === 'Running' ? '⏳ Running...' : '—')}</td>
                    <td className="p-4 text-right space-x-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="px-2 h-8" title="Re-run" onClick={() => handleReRunJob(job)}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                      {(job.status === 'Completed' || job.status === 'Partial') && (
                        <Button variant="ghost" size="sm" className="px-2 h-8" title="Export CSV" onClick={() => handleExportJob(job)}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {(job.status === 'Running' || job.status === 'Queued') ? (
                        <Button variant="ghost" size="sm" className="px-2 h-8 text-status-danger" title="Cancel" onClick={() => handleCancelJob(job.id)}>
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="px-2 h-8 text-status-danger" title="Delete" onClick={() => handleDeleteJob(job)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Job Detail Modal */}
      <Modal
        isOpen={selectedJob !== null}
        onClose={() => { setSelectedJob(null); setLogLines([]); setScrapedLeads([]); }}
        title={selectedJob ? selectedJob.name : ''}
        size="xl"
        footer={selectedJob && (
          <>
            <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
              <User className="w-3.5 h-3.5" /> Started by {selectedJob.triggeredBy}
            </span>
            <div className="flex gap-2">
              {(selectedJob.status === 'Running' || selectedJob.status === 'Queued') ? (
                <Button variant="destructive" size="sm" onClick={() => handleCancelJob(selectedJob.id)}>
                  <XCircle className="w-3.5 h-3.5 mr-1" /> Stop job
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => handleDeleteJob(selectedJob)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => handleReRunJob(selectedJob)}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-run
              </Button>
            </div>
          </>
        )}
      >
        {selectedJob && (() => {
          const p = selectedJob.parameters;
          const isCompanyMode = selectedJob.searchMode === 'companies';
          const isProactiveMode = selectedJob.searchMode === 'proactive';
          const industryStr = p?.industries?.length ? p.industries.join(', ') : 'any industry';
          const subLocation = [...(p?.states || []), ...(p?.cities || [])].join(', ');
          const locationStr = p?.countries?.length
            ? `${p.countries.join(', ')}${subLocation ? ` — ${subLocation}` : ''}`
            : 'any location';
          const sizeStr = isCompanyMode && (p?.sizeRange?.[0] != null || p?.sizeRange?.[1] != null)
            ? ` · ${p?.sizeRange?.[0] ?? 'Any'}-${p?.sizeRange?.[1] ?? 'Any'} employees`
            : '';
          const revenueStr = isCompanyMode && p?.revenueBands?.length ? ` · ${p.revenueBands.join(', ')}` : '';
          const proactiveKeywordsStr = p?.advancedFilters?.proactive_keywords?.length
            ? p.advancedFilters.proactive_keywords.join(', ')
            : (selectedJob.name.includes(': ') ? selectedJob.name.split(': ')[1].split(' [')[0] : 'Proactive Intent');
          const criteriaStr = isProactiveMode
            ? `Proactive Leads · Keywords: ${proactiveKeywordsStr} · ${locationStr}`
            : isCompanyMode
            ? `Companies · ${industryStr} · ${locationStr}${sizeStr}${revenueStr}`
            : `${p?.titles?.length ? p.titles.join(', ') : 'any title'} · ${industryStr} · ${locationStr}`;
          const resultNoun = isCompanyMode ? 'companies' : 'leads';

          return (
            <div className="space-y-5">

              {/* At a glance — one line, no boxed stat tiles */}
              <div className="pb-4 border-b border-border-subtle space-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <StatusBadge status={selectedJob.status} />
                  <span className="text-xs text-text-secondary">
                    <span className="font-heading font-semibold text-text-primary tabular-nums">{selectedJob.leadsFound}</span>
                    {' '}of {p?.limit || 50} {resultNoun} found
                  </span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {criteriaStr}
                </p>
                <div className="w-full bg-border-subtle h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${selectedJob.status === 'Failed' ? 'bg-status-danger' : selectedJob.status === 'Completed' ? 'bg-status-success' : selectedJob.status === 'Partial' ? 'bg-status-warning' : 'bg-brand-primary animate-pulse'}`}
                    style={{ width: `${Math.min(100, (selectedJob.leadsFound / (p?.limit || 50)) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Error Banner */}
              {selectedJob.status === 'Failed' && selectedJob.errors && (
                <div className="p-3.5 bg-status-danger-bg border border-status-danger/25 rounded-card flex items-start space-x-3 text-status-danger">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <h4 className="text-xs font-heading font-semibold">This Search Didn't Finish</h4>
                    <p className="text-xs mt-1">{selectedJob.errors}</p>
                  </div>
                </div>
              )}

              {/* Activity log */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-heading font-semibold text-text-primary">Activity log</h4>
                  {selectedJob.status === 'Running' && (
                    <span className="flex items-center gap-1 text-[10px] text-brand-primary font-medium">
                      <Loader2 className="w-3 h-3 animate-spin" /> Running
                    </span>
                  )}
                </div>
                <div className="bg-bg-canvas/60 text-xs rounded-card border border-border-subtle max-h-40 overflow-y-auto font-mono">
                  {logLines.length === 0 ? (
                    <div className="p-3 text-text-tertiary italic">No activity yet.</div>
                  ) : (
                    <div className="divide-y divide-border-subtle/60">
                      {logLines.map((line, idx) => {
                        const message = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');
                        const timeMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
                        return (
                          <div key={idx} className="px-3 py-1.5 flex items-baseline gap-3">
                            <span className="text-text-tertiary shrink-0">{timeMatch?.[1] || '--:--:--'}</span>
                            <span className="text-text-secondary">{message}</span>
                          </div>
                        );
                      })}
                      <div ref={logEndRef} />
                    </div>
                  )}
                </div>
              </div>

              {/* Scraped Leads Results */}
              {(selectedJob.status === 'Completed' || selectedJob.status === 'Partial') && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-heading font-semibold text-text-primary">
                      {isCompanyMode ? 'Companies found' : 'Contacts found'} <span className="text-text-tertiary font-normal">({scrapedLeads.length})</span>
                      {selectedLeadIds.size > 0 && (
                        <span className="text-brand-primary font-normal ml-1.5">· {selectedLeadIds.size} selected</span>
                      )}
                    </h4>
                    {scrapedLeads.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        {selectedLeadIds.size > 0 && (
                          <Button variant="primary" size="sm" onClick={openComposeForSelected} className="h-7 px-2 text-xs">
                            <Mail className="w-3 h-3 mr-1" /> Send Email ({selectedLeadIds.size})
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={exportLeadsCSV} className="h-7 px-2 text-xs">
                          <Download className="w-3 h-3 mr-1" /> Export CSV
                        </Button>
                      </div>
                    )}
                  </div>

                  {loadingLeads ? (
                    <div className="flex items-center justify-center py-8 text-text-secondary text-xs">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading contacts...
                    </div>
                  ) : scrapedLeads.length === 0 ? (
                    <div className="text-xs text-text-secondary italic text-center py-6 bg-bg-canvas rounded-card border border-border-subtle">
                      No contacts found for this search.
                      <br /><span className="text-text-tertiary">Try running the search again with broader criteria.</span>
                    </div>
                  ) : (
                    // Its own capped, independently scrolling region — this is
                    // what stops a large result set (e.g. 50 leads) from
                    // stretching the whole modal past the screen; only this
                    // table scrolls, the dialog itself stays a fixed size.
                    <div className="border border-border-subtle rounded-card bg-bg-surface overflow-hidden">
                      <div className="overflow-auto max-h-80">
                        {isCompanyMode ? (
                          <table className="w-full border-collapse text-left text-xs">
                            <thead className="sticky top-0 bg-bg-canvas border-b border-border-default font-heading font-semibold text-text-secondary uppercase text-[10px]">
                              <tr>
                                <th className="p-3 w-8">
                                  <input
                                    type="checkbox"
                                    checked={allLeadsSelected}
                                    onChange={toggleSelectAllLeads}
                                    className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                                  />
                                </th>
                                <th className="p-3">Company</th>
                                <th className="p-3">Summary</th>
                                <th className="p-3">Decision Maker</th>
                                <th className="p-3">Activity</th>
                                <th className="p-3">Contact</th>
                                <th className="p-3 text-right">Score</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                              {scrapedLeads.map((lead) => (
                                <tr key={lead.id} className={`hover:bg-bg-canvas/40 transition align-top ${selectedLeadIds.has(lead.id) ? 'bg-brand-primary/[0.04]' : ''}`}>
                                  <td className="p-3">
                                    <input
                                      type="checkbox"
                                      checked={selectedLeadIds.has(lead.id)}
                                      onChange={() => toggleLeadSelected(lead.id)}
                                      className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                                    />
                                  </td>
                                  <td className="p-3 min-w-[160px]">
                                    <span className="font-heading font-semibold text-text-primary block">{lead.company.name || 'Not available'}</span>
                                    {lead.company.website ? (
                                      <a href={lead.company.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-brand-primary hover:underline mt-0.5 truncate max-w-[160px]">
                                        {lead.company.website.replace(/^https?:\/\//, '')} <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                      </a>
                                    ) : (
                                      <span className="text-[10px] text-text-tertiary italic block mt-0.5">Website not available</span>
                                    )}
                                    {lead.company.linkedinUrl && (
                                      <a href={lead.company.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-text-tertiary hover:text-brand-primary mt-0.5">
                                        <Linkedin className="w-2.5 h-2.5 shrink-0" /> Company profile
                                      </a>
                                    )}
                                  </td>
                                  <td className="p-3 min-w-[200px] max-w-[260px]">
                                    <span className="text-text-secondary line-clamp-3" title={lead.company.overview || ''}>
                                      {lead.company.overview || <span className="text-text-tertiary italic">Not available</span>}
                                    </span>
                                  </td>
                                  <td className="p-3 min-w-[150px]">
                                    <span className="font-heading font-semibold text-text-primary block">
                                      {lead.decisionMaker.full_name === 'Not identified' ? (
                                        <span className="text-text-tertiary italic font-normal">Not identified</span>
                                      ) : lead.decisionMaker.full_name}
                                    </span>
                                    <span className="text-[10px] text-text-secondary block">
                                      {lead.decisionMaker.designation === 'Not available'
                                        ? <span className="text-text-tertiary italic">Not available</span>
                                        : lead.decisionMaker.designation}
                                    </span>
                                    {lead.decisionMaker.linkedin_url && (
                                      <a href={lead.decisionMaker.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-text-tertiary hover:text-brand-primary mt-0.5">
                                        <Linkedin className="w-2.5 h-2.5 shrink-0" /> Profile
                                      </a>
                                    )}
                                  </td>
                                  <td className="p-3 min-w-[140px]">
                                    {lead.activitySignals.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {lead.activitySignals.slice(0, 3).map((sig, i) => (
                                          <Badge key={i} variant="info" className="text-[9px]">{sig}</Badge>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-text-tertiary italic">No signals found</span>
                                    )}
                                  </td>
                                  <td className="p-3 font-mono min-w-[150px]">
                                    <div className="flex items-start justify-between gap-1.5">
                                      <div className="min-w-0">
                                        {lead.decisionMaker.email ? (
                                          <a href={`mailto:${lead.decisionMaker.email}`} className="block text-[10px] text-brand-primary hover:underline truncate max-w-[140px]">
                                            {lead.decisionMaker.email}
                                          </a>
                                        ) : (
                                          <span className="block text-[10px] text-text-tertiary italic font-sans">Email not available</span>
                                        )}
                                        {lead.decisionMaker.phone ? (
                                          <span className="block text-[10px] text-text-secondary mt-0.5">{lead.decisionMaker.phone}</span>
                                        ) : (
                                          <span className="block text-[10px] text-text-tertiary italic font-sans mt-0.5">Phone not available</span>
                                        )}
                                      </div>
                                      {lead.decisionMaker.email && (
                                        <button
                                          type="button"
                                          title="Send email"
                                          onClick={() => openComposeForOne(lead)}
                                          className="p-1 rounded text-text-tertiary hover:text-brand-primary hover:bg-bg-canvas transition shrink-0"
                                        >
                                          <Send className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-3 text-right">
                                    {lead.score === null ? (
                                      <span className="text-text-tertiary text-xs">—</span>
                                    ) : (
                                      <span className={`font-heading font-bold tabular-nums text-sm ${lead.score >= 80 ? 'text-status-success' : 'text-brand-primary'}`}>
                                        {lead.score}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <table className="w-full border-collapse text-left text-xs">
                            <thead className="sticky top-0 bg-bg-canvas border-b border-border-default font-heading font-semibold text-text-secondary uppercase text-[10px]">
                              <tr>
                                <th className="p-3 w-8">
                                  <input
                                    type="checkbox"
                                    checked={allLeadsSelected}
                                    onChange={toggleSelectAllLeads}
                                    className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                                  />
                                </th>
                                <th className="p-3">Name / Title</th>
                                <th className="p-3">Company</th>
                                <th className="p-3">Contact</th>
                                <th className="p-3 text-right">Score</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                              {scrapedLeads.map((lead) => (
                                <tr key={lead.id} className={`hover:bg-bg-canvas/40 transition ${selectedLeadIds.has(lead.id) ? 'bg-brand-primary/[0.04]' : ''}`}>
                                  <td className="p-3">
                                    <input
                                      type="checkbox"
                                      checked={selectedLeadIds.has(lead.id)}
                                      onChange={() => toggleLeadSelected(lead.id)}
                                      className="rounded border-border-default text-brand-primary focus:ring-brand-primary"
                                    />
                                  </td>
                                  <td className="p-3">
                                    <span className="font-heading font-semibold text-text-primary block">{lead.decisionMaker?.full_name || '—'}</span>
                                    <span className="text-[10px] text-text-secondary">{lead.decisionMaker?.designation || '—'}</span>
                                  </td>
                                  <td className="p-3">
                                    <span className="font-heading font-semibold text-text-primary block">{lead.company?.name || '—'}</span>
                                    <span className="text-[10px] text-text-secondary">{lead.company?.industry || '—'}</span>
                                    {lead.company?.website && (
                                      <a href={lead.company.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-[10px] text-brand-primary hover:underline mt-0.5 truncate max-w-[160px]">
                                        {lead.company.website.replace(/^https?:\/\//, '')} <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                      </a>
                                    )}
                                  </td>
                                  <td className="p-3 font-mono">
                                    <div className="flex items-start justify-between gap-1.5">
                                      <div className="min-w-0">
                                        {lead.decisionMaker?.email ? (
                                          <a href={`mailto:${lead.decisionMaker.email}`} className="block text-[10px] text-brand-primary hover:underline truncate max-w-[140px]">
                                            {lead.decisionMaker.email}
                                          </a>
                                        ) : (
                                          <span className="block text-[10px] text-text-tertiary italic font-sans">Not available</span>
                                        )}
                                        {lead.decisionMaker?.phone && (
                                          <span className="block text-[10px] text-text-secondary mt-0.5">{lead.decisionMaker.phone}</span>
                                        )}
                                        {lead.decisionMaker?.linkedin_url && lead.decisionMaker.linkedin_url.includes('linkedin.com') && (
                                          <a href={lead.decisionMaker.linkedin_url} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-text-tertiary hover:text-brand-primary truncate max-w-[140px] mt-0.5">
                                            LinkedIn ↗
                                          </a>
                                        )}
                                      </div>
                                      {lead.decisionMaker?.email && (
                                        <button
                                          type="button"
                                          title="Send email"
                                          onClick={() => openComposeForOne(lead)}
                                          className="p-1 rounded text-text-tertiary hover:text-brand-primary hover:bg-bg-canvas transition shrink-0"
                                        >
                                          <Send className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-3 text-right">
                                    {lead.score === null ? (
                                      <span className="text-text-tertiary text-xs">—</span>
                                    ) : (
                                      <span className={`font-heading font-bold tabular-nums text-sm ${lead.score >= 80 ? 'text-status-success' : 'text-brand-primary'}`}>
                                        {lead.score}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Page-level compose — recipient picker across every job, then the same compose/send modal */}
      <LeadPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onContinue={handlePickerContinue}
      />

      {/* Cold email compose/send — triggered from the leads table above, or from the page-level picker */}
      <EmailComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        recipients={composeRecipients}
        onSent={() => setSelectedLeadIds(new Set())}
      />

      <ConfirmDialog
        isOpen={confirmAction !== null}
        message={confirmAction?.message || ''}
        confirmLabel={confirmAction?.confirmLabel || 'Confirm'}
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
