import { create } from 'zustand';
import { getStoredUser, getStoredWorkspaceId, setStoredWorkspaceId } from '../services/sourcingApi';
import type { WorkspaceRecord } from '../services/sourcingApi';

export interface AppNotification {
  id: string;
  type: 'job_completed' | 'job_partial' | 'job_failed' | 'email_sent' | 'email_partial' | 'email_failed' | 'team_invited' | 'team_member_first_login';
  title: string;
  desc: string;
  time: string; // ISO timestamp
  unread: boolean;
  jobId?: string;
}

interface UiState {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  onboardingStep: number | null; // null means onboarding completed
  setOnboardingStep: (step: number | null) => void;

  // Real, DB-backed workspaces — sub-tenants inside the org, each with
  // fully isolated leads/companies/jobs/messages/templates/etc. Every
  // teammate in the org can see and switch into every workspace here (no
  // per-workspace membership). activeWorkspaceId is sent as the
  // X-Workspace-Id header on every API call (see sourcingApi.ts's
  // request()), and persisted to localStorage so a refresh keeps it.
  workspaces: WorkspaceRecord[];
  setWorkspaces: (workspaces: WorkspaceRecord[]) => void;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;

  selectedLeadIds: string[];
  setSelectedLeadIds: (ids: string[]) => void;
  selectedMessageIds: string[];
  setSelectedMessageIds: (ids: string[]) => void;
  
  // Quick filters for Lead list
  leadStatusFilter: string;
  setLeadStatusFilter: (status: string) => void;
  leadSearchQuery: string;
  setLeadSearchQuery: (query: string) => void;

  // Real, DB-backed notification feed (job completions, email sends, etc.) —
  // this store just mirrors whatever NotificationSync last fetched from the
  // server; all mutations (read/unread/delete) go through the API first.
  notifications: AppNotification[];
  setNotifications: (notifications: AppNotification[]) => void;

  // Active auth token/user simulation
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatarUrl?: string;
    defaultWorkspaceId?: string | null;
  } | null;
  setCurrentUser: (user: any | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: (localStorage.getItem('salesai-theme') as 'light' | 'dark') || 'light',
  setTheme: (theme) => {
    localStorage.setItem('salesai-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme });
  },
  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  
  // Onboarding wizard defaults to step 1 if not marked completed in localStorage
  onboardingStep: localStorage.getItem('salesai-onboarding-completed') ? null : 1,
  setOnboardingStep: (step) => {
    if (step === null) {
      localStorage.setItem('salesai-onboarding-completed', 'true');
    }
    set({ onboardingStep: step });
  },
  
  workspaces: [],
  setWorkspaces: (workspaces) => set({ workspaces }),
  activeWorkspaceId: getStoredWorkspaceId(),
  setActiveWorkspaceId: (id) => {
    setStoredWorkspaceId(id);
    set({ activeWorkspaceId: id });
  },

  selectedLeadIds: [],
  setSelectedLeadIds: (selectedLeadIds) => set({ selectedLeadIds }),
  selectedMessageIds: [],
  setSelectedMessageIds: (selectedMessageIds) => set({ selectedMessageIds }),
  
  leadStatusFilter: 'All',
  setLeadStatusFilter: (leadStatusFilter) => set({ leadStatusFilter }),
  leadSearchQuery: '',
  setLeadSearchQuery: (leadSearchQuery) => set({ leadSearchQuery }),
  
  notifications: [],
  setNotifications: (notifications) => set({ notifications }),

  // Reflects the real logged-in session — null means no one is logged in,
  // which correctly sends the app to /login instead of faking access.
  currentUser: getStoredUser(),
  setCurrentUser: (currentUser) => set({ currentUser }),
}));
