const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '/api/v1';

function getStoredToken(): string {
  return localStorage.getItem('sales_ai_token') || '';
}

function setStoredToken(token: string) {
  if (token) {
    localStorage.setItem('sales_ai_token', token);
  }
}

function setStoredUser(user: unknown) {
  if (user) {
    localStorage.setItem('sales_ai_user', JSON.stringify(user));
  }
}

export function getStoredUser(): any | null {
  try {
    const raw = localStorage.getItem('sales_ai_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const ACTIVE_WORKSPACE_KEY = 'sales_ai_active_workspace_id';

export function getStoredWorkspaceId(): string | null {
  return localStorage.getItem(ACTIVE_WORKSPACE_KEY);
}

export function setStoredWorkspaceId(id: string | null) {
  if (id) {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  }
}

export function logout() {
  localStorage.removeItem('sales_ai_token');
  localStorage.removeItem('sales_ai_user');
  localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
}

// Fired whenever a request comes back 401 — a global listener (mounted once
// in AppShell) shows an in-app "session expired" modal and redirects to
// /login. A plain DOM event (rather than importing the Zustand store here)
// avoids a circular import, since useUiStore itself imports getStoredUser
// from this file.
export const SESSION_EXPIRED_EVENT = 'sales-ai:session-expired';

export async function loginWithBackend(email: string, password: string): Promise<{ access_token: string; user?: any }> {
  const response = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details?.detail || 'Unable to authenticate with backend');
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error('Authentication response was invalid');
  }

  setStoredToken(payload.access_token);
  setStoredUser(payload.user);
  return payload;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const workspaceId = getStoredWorkspaceId();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (workspaceId) {
    headers.set('X-Workspace-Id', workspaceId);
  }

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // The stored session is invalid/expired — clear it so the app doesn't
    // keep sending a dead token, and require a real re-login rather than
    // silently re-authenticating as a default account. Dispatched once per
    // 401 (every in-flight/poll request will each fire this — the listener
    // is idempotent about showing a single modal) rather than redirecting
    // here directly, so the user sees an explanatory modal instead of the
    // page silently vanishing out from under them.
    logout();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new Error('Your session has expired. Please log in again.');
  }

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const message = details?.detail || details?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export async function listSearches(): Promise<any[]> {
  return request<any[]>('/searches');
}

export async function createSearch(payload: any): Promise<any> {
  const searchMode = payload.searchMode || payload.search_mode || 'individuals';
  // Company size is a Companies-mode-only criterion — never send a stale
  // size filter for an Individuals-mode search. `null`/`undefined` means
  // "no size constraint", not a fabricated 10-500 default.
  const sizeMin = searchMode === 'companies' ? (payload.sizeRange?.[0] ?? payload.company_size_min ?? null) : null;
  const sizeMax = searchMode === 'companies' ? (payload.sizeRange?.[1] ?? payload.company_size_max ?? null) : null;
  // Revenue bands are a Companies-mode-only criterion too — never send a
  // stale revenue filter for an Individuals-mode search.
  const revenueBands = searchMode === 'companies' ? (payload.revenueBands || payload.revenue_bands || []) : [];
  return request<any>('/searches', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      countries: payload.countries || [],
      states: payload.states || [],
      cities: payload.cities || [],
      industries: payload.industries || [],
      // Companies mode doesn't target a specific title — never send stale titles for it.
      designations: searchMode === 'companies' ? [] : (payload.titles || payload.designations || []),
      lead_count_target: payload.limit || payload.lead_count_target || 50,
      company_size_min: sizeMin,
      company_size_max: sizeMax,
      revenue_bands: revenueBands,
      advanced_filters: payload.advancedFilters || payload.advanced_filters || {},
      schedule: payload.schedule || {},
      search_mode: searchMode,
    }),
  });
}

export async function runSearch(searchId: string): Promise<any> {
  return request<any>(`/searches/${searchId}/run`, {
    method: 'POST',
  });
}

export async function deleteSearch(searchId: string): Promise<any> {
  return request<any>(`/searches/${searchId}`, {
    method: 'DELETE',
  });
}

export async function cancelSearchSchedule(searchId: string): Promise<any> {
  return request<any>(`/searches/${searchId}/schedule`, {
    method: 'DELETE',
  });
}

export async function estimateSearch(payload: any): Promise<any> {
  const searchMode = payload.searchMode || payload.search_mode || 'individuals';
  const sizeMin = searchMode === 'companies' ? (payload.sizeRange?.[0] ?? payload.company_size_min ?? null) : null;
  const sizeMax = searchMode === 'companies' ? (payload.sizeRange?.[1] ?? payload.company_size_max ?? null) : null;
  const revenueBands = searchMode === 'companies' ? (payload.revenueBands || payload.revenue_bands || []) : [];
  return request<any>('/searches/estimate', {
    method: 'POST',
    body: JSON.stringify({
      countries: payload.countries || [],
      states: payload.states || [],
      cities: payload.cities || [],
      industries: payload.industries || [],
      designations: searchMode === 'companies' ? [] : (payload.titles || payload.designations || []),
      search_mode: searchMode,
      company_size_min: sizeMin,
      company_size_max: sizeMax,
      revenue_bands: revenueBands,
    }),
  });
}

export async function listJobs(): Promise<any> {
  return request<any>('/jobs');
}

export async function getJob(jobId: string): Promise<any> {
  return request<any>(`/jobs/${jobId}`);
}

export async function cancelJob(jobId: string): Promise<any> {
  return request<any>(`/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
}

export async function deleteJob(jobId: string): Promise<any> {
  return request<any>(`/jobs/${jobId}`, {
    method: 'DELETE',
  });
}

export async function getLeadsForJob(jobId: string): Promise<any> {
  return request<any>(`/leads?job_id=${jobId}&pageSize=100`);
}

export async function rerunJob(job: any): Promise<any> {
  const createdSearch = await createSearch({
    name: `${job.name} (Re-run)`,
    countries: job.parameters?.countries || [],
    states: job.parameters?.states || [],
    cities: job.parameters?.cities || [],
    industries: job.parameters?.industries || [],
    titles: job.parameters?.titles || [],
    limit: job.parameters?.limit || 50,
    sizeRange: job.parameters?.sizeRange || [null, null],
    revenueBands: job.parameters?.revenueBands || [],
    advancedFilters: {},
    schedule: {},
    searchMode: job.searchMode || job.parameters?.searchMode || 'individuals',
  });
  return runSearch(createdSearch.id);
}

// ─── Lead Validation (Lead Validation & Scoring page) ─────────────────────

export async function getLeads(params: { searchMode?: 'individuals' | 'companies'; status?: string; jobId?: string } = {}): Promise<any> {
  const qs = new URLSearchParams();
  qs.set('pageSize', '200');
  if (params.searchMode) qs.set('search_mode', params.searchMode);
  if (params.status) qs.set('status', params.status);
  if (params.jobId) qs.set('job_id', params.jobId);
  return request<any>(`/leads?${qs.toString()}`);
}

// Fetches every lead in the current workspace that has an email address —
// used by the compose recipient picker, which previously silently truncated
// at 200 leads (getLeads()'s hardcoded pageSize). Pages through in bounded
// chunks rather than one giant request, so a very large workspace doesn't
// block on a single slow response, but still accumulates everything
// realistic (capped at 20 pages / 10,000 leads as a hard safety limit).
export async function getAllLeadsWithEmail(): Promise<any[]> {
  const pageSize = 500;
  const maxPages = 20;
  const all: any[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('pageSize', String(pageSize));
    qs.set('has_email', 'true');
    const res = await request<any>(`/leads?${qs.toString()}`);
    const batch = res?.data || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }

  return all;
}

export async function createAdHocLead(payload: { name: string; email: string; company?: string; title?: string }): Promise<any> {
  return request<any>('/leads/adhoc', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function approveLead(leadId: string): Promise<any> {
  return request<any>(`/leads/${leadId}/approve`, { method: 'POST' });
}

export async function rejectLead(leadId: string): Promise<any> {
  return request<any>(`/leads/${leadId}/reject`, { method: 'POST' });
}

export async function updateLeadStatus(leadId: string, status: string): Promise<any> {
  return request<any>(`/leads/${leadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function updateLeadNotes(leadId: string, notes: string): Promise<any> {
  return request<any>(`/leads/${leadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}

export async function deleteLead(leadId: string): Promise<any> {
  return request<any>(`/leads/${leadId}`, { method: 'DELETE' });
}

export async function bulkDeleteLeads(ids: string[]): Promise<{ success: boolean; deleted: number; requested: number }> {
  return request<any>('/leads/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

// ─── Outbound email (cold email send) ──────────────────────────────────────

export interface EmailAttachmentRef {
  filename: string;
  key: string;
  contentType?: string;
  size?: number;
  url?: string;
}

export async function sendColdEmails(
  leadIds: string[],
  subject: string,
  body: string,
  cc: string[] = [],
  attachments: EmailAttachmentRef[] = [],
  templateId?: string | null
): Promise<{ sent: number; failed: number; results: any[]; batchId: string | null }> {
  return request<any>('/messages/send-email', {
    method: 'POST',
    body: JSON.stringify({ leadIds, subject, body, cc, attachments, templateId: templateId || null }),
  });
}

export interface PerRecipientEmail {
  leadId: string;
  subject: string;
  body: string;
}

// "Send separately" — each recipient carries their own already-personalized
// subject/body instead of one template applied to everyone.
export async function sendColdEmailsSeparately(
  messages: PerRecipientEmail[],
  cc: string[] = [],
  attachments: EmailAttachmentRef[] = [],
  templateId?: string | null
): Promise<{ sent: number; failed: number; results: any[]; batchId: string | null }> {
  return request<any>('/messages/send-email', {
    method: 'POST',
    body: JSON.stringify({ messages, cc, attachments, templateId: templateId || null }),
  });
}

// Uploads one file to S3 ahead of a send — multipart, so it bypasses the
// JSON `request()` helper's Content-Type header (the browser needs to set
// its own multipart boundary).
export async function uploadAttachment(file: File): Promise<EmailAttachmentRef> {
  const token = getStoredToken();
  const workspaceId = getStoredWorkspaceId();
  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;

  const response = await fetch(`${BACKEND_URL}/messages/attachments`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details?.detail || `Upload failed for ${file.name}`);
  }

  return response.json();
}

export async function getMessages(params: { status?: string } = {}): Promise<any> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<any>(`/messages${suffix}`);
}

export async function createMessageDraft(payload: {
  leadId: string;
  type: string;
  subject?: string;
  body?: string;
  tone?: string;
  length?: string;
}): Promise<any> {
  return request<any>('/messages/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function aiRewriteMessage(payload: { subject?: string; body: string; instruction?: string }): Promise<{ subject: string | null; body: string }> {
  return request<any>('/messages/ai-rewrite', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function approveMessage(id: string): Promise<any> {
  return request<any>(`/messages/${id}/approve`, { method: 'POST' });
}

export async function rejectMessage(id: string): Promise<any> {
  return request<any>(`/messages/${id}/reject`, { method: 'POST' });
}

export async function sendApprovedMessage(id: string): Promise<any> {
  return request<any>(`/messages/${id}/send`, { method: 'POST' });
}

export async function updateMessageDraft(id: string, payload: { subject?: string; body?: string }): Promise<any> {
  return request<any>(`/messages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function bulkApproveMessages(ids: string[]): Promise<{ success: boolean; count: number }> {
  return request<any>('/messages/bulk-approve', {
    method: 'POST',
    body: JSON.stringify(ids),
  });
}

// ─── Dashboard & Analytics (real, backend-computed) ────────────────────────
// Each dashboard section is its own endpoint/call so the page can render
// each one the moment its own request resolves, instead of waiting for a
// single bundled response.

export async function getDashboardKpis(): Promise<any> {
  return request<any>('/dashboard/kpis');
}

export async function getDashboardFunnel(): Promise<any> {
  return request<any>('/dashboard/funnel');
}

export async function getDashboardLeadsOverTime(days: number = 30): Promise<any> {
  return request<any>(`/dashboard/leads-over-time?days=${days}`);
}

export async function getDashboardActivities(): Promise<any> {
  return request<any>('/dashboard/activities');
}

export async function getDashboardAttention(): Promise<any> {
  return request<any>('/dashboard/attention');
}

export async function getAnalyticsSummary(range: '7d' | '30d' | '90d' = '7d'): Promise<any> {
  return request<any>(`/analytics/summary?range=${range}`);
}

// ─── Templates library ──────────────────────────────────────────────────────

export interface TemplateRecord {
  id: string;
  name: string;
  type: 'Cold Email' | 'LinkedIn Connection Note' | 'Follow-up' | 'Proposal';
  channel: 'email' | 'linkedin';
  subject: string | null;
  body: string;
  tags: string[];
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function listTemplates(): Promise<{ data: TemplateRecord[]; total: number }> {
  return request<any>('/templates');
}

export async function saveTemplate(payload: {
  id?: string;
  name: string;
  type: TemplateRecord['type'];
  subject?: string | null;
  body: string;
  tags?: string[];
}): Promise<TemplateRecord> {
  return request<any>('/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteTemplate(id: string): Promise<any> {
  return request<any>(`/templates/${id}`, { method: 'DELETE' });
}

// ─── Notifications (DB-backed) ─────────────────────────────────────────────

export async function getNotifications(unreadOnly = false): Promise<{ data: any[]; unreadCount: number }> {
  return request<any>(`/notifications${unreadOnly ? '?unreadOnly=true' : ''}`);
}

export async function setNotificationRead(id: string, read: boolean): Promise<any> {
  return request<any>(`/notifications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ read }),
  });
}

export async function deleteNotification(id: string): Promise<any> {
  return request<any>(`/notifications/${id}`, { method: 'DELETE' });
}

export async function markAllNotificationsRead(): Promise<any> {
  return request<any>('/notifications/mark-all-read', { method: 'POST' });
}

// ─── Team management (real, DB-backed) ─────────────────────────────────────

export interface TeamInviteItem {
  email: string;
  password: string;
  role: string;
  name?: string;
}

export interface TeamInviteResult {
  email: string;
  success: boolean;
  emailSent: boolean;
  error: string | null;
}

export async function listTeam(): Promise<{ data: any[]; page: number; pageSize: number; total: number }> {
  return request<any>('/team');
}

export async function inviteTeammates(invites: TeamInviteItem[]): Promise<{ success: boolean; invited: number; total: number; results: TeamInviteResult[] }> {
  return request<any>('/team', {
    method: 'POST',
    body: JSON.stringify({ invites }),
  });
}

export async function updateTeammate(id: string, payload: { role?: string; status?: string }): Promise<any> {
  return request<any>(`/team/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteTeammate(id: string): Promise<any> {
  return request<any>(`/team/${id}`, { method: 'DELETE' });
}

// ─── Unified Inbox (real reply threads) ────────────────────────────────────

export async function getConversations(): Promise<{ data: any[]; total: number }> {
  return request<any>('/inbox/conversations');
}

export async function sendInboxReply(threadId: string, body: string): Promise<any> {
  return request<any>(`/inbox/conversations/${threadId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function updateThreadSentiment(threadId: string, sentiment: string): Promise<any> {
  return request<any>(`/inbox/conversations/${threadId}/sentiment`, {
    method: 'POST',
    body: JSON.stringify({ sentiment }),
  });
}

// ─── Audit log (real, DB-backed) ────────────────────────────────────────────

export async function getAuditLogs(): Promise<{ data: any[]; total: number }> {
  return request<any>('/audit-log');
}

// ─── Account settings ───────────────────────────────────────────────────────

export async function changePassword(currentPassword: string, newPassword: string): Promise<any> {
  return request<any>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

// ─── Workspaces (real, DB-backed multi-workspace support) ──────────────────

export interface WorkspaceRecord {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string | null;
  createdBy: string | null;
}

export async function listWorkspaces(): Promise<{ data: WorkspaceRecord[] }> {
  return request<any>('/workspaces');
}

export async function createWorkspace(name: string): Promise<WorkspaceRecord> {
  return request<any>('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function renameWorkspace(id: string, name: string): Promise<WorkspaceRecord> {
  return request<any>(`/workspaces/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteWorkspace(id: string, confirmName: string): Promise<any> {
  return request<any>(`/workspaces/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirm_name: confirmName }),
  });
}

export async function switchWorkspace(id: string): Promise<WorkspaceRecord> {
  return request<any>(`/workspaces/${id}/switch`, { method: 'POST' });
}
