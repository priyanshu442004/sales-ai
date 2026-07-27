export interface ApiResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Sales Manager' | 'Sales Rep' | 'Reviewer-only';
  status: 'Active' | 'Invited' | 'Suspended';
  lastActive: string;
  avatarUrl?: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  logo: string;
  industry: string;
  location: string;
  employeeCount: number;
  sizeRange?: string;
  revenueRange?: string;
  revenueBand?: string;
  linkedInUrl?: string;
  fundingStage?: string;
  techStack?: string[];
  hiringSignals?: string[];
  overview?: string;
}

export interface DecisionMaker {
  id: string;
  name: string;
  designation: string;
  companyId: string;
  email?: string;
  phone?: string;
  linkedInUrl?: string;
  avatarUrl?: string;
  tenure?: string;
  scoreExplanation?: string;
  notes?: string;
}

export interface ScrapeJob {
  id: string;
  name: string;
  parameters: {
    countries: string[];
    industries: string[];
    titles: string[];
    limit: number;
    sizeRange: [number | null, number | null];
  };
  status: 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Partial';
  progress: {
    scraped: number;
    target: number;
  };
  startedAt: string;
  duration?: string;
  triggeredBy: string;
  logs: string[];
  errors?: string;
}

export interface Lead {
  id: string;
  company: Company;
  decisionMaker: DecisionMaker;
  score: number; // 0 to 100
  priority: 'High' | 'Medium' | 'Low';
  status: 'New' | 'Approved' | 'Rejected' | 'Needs Info';
  activitySignals: string[];
  contactCompleteness: {
    email: boolean;
    phone: boolean;
    linkedIn: boolean;
  };
  sourceJobId: string;
  sourceJobName: string;
  dateScraped: string;
  scoreFactors: {
    industryFit: number;
    companySize: number;
    activityStrength: number;
    seniorityMatch: number;
    dataCompleteness: number;
  };
}

export type ChannelType = 'email' | 'linkedin';

export interface MessageDraft {
  id: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  recipient: string;
  channel: ChannelType;
  type: 'Cold Email' | 'LinkedIn Connection Note' | 'Follow-up' | 'Proposal';
  subject?: string;
  body: string;
  generatedBy: 'AI' | 'Manual';
  status: 'Pending Approval' | 'Approved' | 'Sent' | 'Rejected' | 'Draft';
  createdAt: string;
  spamScore?: {
    score: number; // 0 to 100
    warnings: string[];
  };
}

export interface SequenceStep {
  id: string;
  stepNumber: number;
  type: 'email' | 'linkedin_connect' | 'linkedin_message' | 'delay';
  delayDays?: number;
  templateId?: string;
  subject?: string;
  body?: string;
}

export interface Sequence {
  id: string;
  name: string;
  steps: SequenceStep[];
  enrolledLeadsCount: number;
  conversionMetrics: {
    sent: number;
    replied: number;
    meetings: number;
  };
  exitConditions: {
    replyReceived: boolean;
    meetingBooked: boolean;
    unsubscribed: boolean;
  };
  status: 'active' | 'draft' | 'paused';
}

export interface Campaign {
  id: string;
  name: string;
  status: 'Active' | 'Paused' | 'Completed' | 'Draft';
  metrics: {
    sent: number;
    delivered: number;
    opened: number;
    replied: number;
    bounced: number;
    linkedInAccepted: number;
    meetingsBooked: number;
  };
  recipientStatus: Array<{
    leadId: string;
    leadName: string;
    companyName: string;
    status: 'Sent' | 'Delivered' | 'Opened' | 'Replied' | 'Bounced';
    lastUpdated: string;
  }>;
  createdAt: string;
}

export interface InboxThread {
  id: string;
  leadId: string;
  leadName: string;
  companyName: string;
  subject?: string;
  channel: ChannelType;
  lastMessageSnippet: string;
  lastMessageTime: string;
  unread: boolean;
  sentiment?: 'Positive' | 'Neutral' | 'Negative' | 'Out-of-office';
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    body: string;
    timestamp: string;
    senderName: string;
  }>;
}

export interface Template {
  id: string;
  name: string;
  type: 'Email' | 'LinkedIn' | 'Follow-up' | 'Proposal';
  subject?: string;
  body: string;
  lastUsed: string;
  replyRate?: number;
  tags: string[];
}

export interface Integration {
  id: string;
  name: string;
  category: 'data_provider' | 'outbound' | 'crm';
  connected: boolean;
  lastSyncedAt?: string;
  icon: string;
  description: string;
  quota?: {
    used: number;
    limit: number;
    unit: string;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorEmail: string;
  action: string; // 'Approved Lead' | 'Rejected Lead' | 'Sent Email' | 'Scored Lead' | etc.
  category?: 'AUTH' | 'SCRAPE' | 'OUTBOUND' | 'WORKSPACE' | 'SCORING';
  targetEntityLink: string;
  targetEntityName: string;
  ipAddress: string;
  deviceMetadata: string;
}
