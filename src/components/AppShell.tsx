import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Search, Cpu, ClipboardList, Send,
  Inbox, FileText, BarChart3, Sliders, Users, Settings, History,
  Bell, ChevronDown, Sun, Moon, Layers, ShieldAlert,
  LogOut, ChevronRight, PanelLeftClose, PanelLeftOpen, Database, Plus
} from 'lucide-react';
import { toast } from 'sonner';
import { useUiStore } from '../store/useUiStore';
import {
  logout as clearStoredSession, listWorkspaces, createWorkspace, switchWorkspace,
  getDashboardKpis,
} from '../services/sourcingApi';
import { Avatar, Modal, Button } from './ui/core';
import { CommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { OnboardingWizard } from './OnboardingWizard';
import { NotificationSync } from './NotificationSync';
import { SessionExpiredModal } from './SessionExpiredModal';
import { Toaster } from 'sonner';

const _CAN_MANAGE_WORKSPACES = new Set(['Admin', 'Sales Manager']);

export const AppShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    theme, setTheme,
    sidebarCollapsed, setSidebarCollapsed,
    setCommandPaletteOpen,
    workspaces, setWorkspaces, activeWorkspaceId, setActiveWorkspaceId,
    notifications, currentUser, setCurrentUser
  } = useUiStore();

  const unreadNotificationCount = notifications.filter(n => n.unread).length;

  const [notifCenterOpen, setNotifCenterOpen] = useState(false);
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  // Real, DB-backed pending-approvals count — was previously computed off a
  // static mock array that never reflected the actual database.
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);

  const canManageWorkspaces = !!currentUser && _CAN_MANAGE_WORKSPACES.has(currentUser.role);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;

  useEffect(() => {
    getDashboardKpis()
      .then((data) => setPendingApprovalsCount(data?.pendingSends?.value ?? 0))
      .catch(() => setPendingApprovalsCount(0));
  }, [activeWorkspaceId]);

  // Load every workspace the org owns, and resolve which one is active:
  // the previously-saved localStorage value if it's still valid, else the
  // user's remembered server-side default, else the org's default workspace.
  useEffect(() => {
    listWorkspaces()
      .then((res) => {
        const list = res?.data || [];
        setWorkspaces(list);
        const stillValid = list.some((w) => w.id === activeWorkspaceId);
        if (!stillValid) {
          const fallback =
            list.find((w) => w.id === currentUser?.defaultWorkspaceId) ||
            list.find((w) => w.isDefault) ||
            list[0] ||
            null;
          setActiveWorkspaceId(fallback?.id || null);
        }
      })
      .catch(() => toast.error('Failed to load workspaces.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSwitchWorkspace = async (id: string) => {
    setWorkspaceDropdownOpen(false);
    if (id === activeWorkspaceId) return;
    try {
      await switchWorkspace(id);
      setActiveWorkspaceId(id);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to switch workspace.');
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) {
      toast.error('Workspace name is required.');
      return;
    }
    setCreatingWorkspace(true);
    try {
      const ws = await createWorkspace(newWorkspaceName.trim());
      setWorkspaces([...workspaces, ws]);
      await switchWorkspace(ws.id);
      setActiveWorkspaceId(ws.id);
      setCreateWorkspaceOpen(false);
      setNewWorkspaceName('');
      toast.success(`Workspace "${ws.name}" created.`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create workspace.');
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleLogout = () => {
    clearStoredSession();
    setCurrentUser(null);
    navigate('/login');
  };

  // Nav configuration
  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { name: 'Lead Search', icon: Search, path: '/search' },
    { name: 'Jobs Queue', icon: Cpu, path: '/jobs' },
    { name: 'All Leads', icon: Database, path: '/leads/all' },
    { name: 'Lead Validation', icon: ClipboardList, path: '/leads' },
    {
      name: 'Outreach',
      icon: Send,
      path: '/outreach',
      subItems: [
        { name: 'Outreach Studio', path: '/outreach/studio' },
        { name: 'Approval Queue', path: '/outreach/approval', badge: pendingApprovalsCount },
        { name: 'Sequences', path: '/outreach/sequences' },
        { name: 'Campaigns', path: '/outreach/campaigns' },
      ]
    },
    { name: 'Unified Inbox', icon: Inbox, path: '/inbox' },
    { name: 'Templates Library', icon: FileText, path: '/templates' },
    { name: 'Analytics', icon: BarChart3, path: '/analytics' },
    { name: 'Integrations', icon: Sliders, path: '/integrations' },
    { name: 'Team & Roles', icon: Users, path: '/team' },
  ];

  const bottomNavItems = [
    { name: 'Settings', icon: Settings, path: '/settings' },
    { name: 'Audit Log', icon: History, path: '/audit-log' },
  ];

  return (
    <div className="min-h-screen flex bg-bg-canvas text-text-primary transition-colors duration-200">
      <Toaster position="top-right" theme={theme} />
      <CommandPalette />
      <NotificationCenter isOpen={notifCenterOpen} onClose={() => setNotifCenterOpen(false)} />
      <OnboardingWizard />
      <NotificationSync />
      <SessionExpiredModal />

      {/* 1. LEFT SIDEBAR */}
      <aside 
        className={`bg-bg-surface border-r border-border-subtle flex flex-col justify-between transition-all duration-300 z-10 shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Sidebar Header */}
        <div className="h-14 px-4 border-b border-border-subtle flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 bg-brand-primary rounded-btn flex items-center justify-center text-white">
                <Layers className="w-4 h-4 text-brand-accent" />
              </div>
              <span className="font-heading font-bold text-lg tracking-tight text-text-primary">Sales AI</span>
              <span className="text-[9px] bg-brand-accent/15 text-brand-accent border border-brand-accent/25 px-1 py-0.2 rounded font-heading font-medium tracking-wide">ENT</span>
            </div>
          )}
          {sidebarCollapsed && (
            <div className="w-7 h-7 bg-brand-primary rounded-btn flex items-center justify-center text-white mx-auto">
              <Layers className="w-4 h-4 text-brand-accent" />
            </div>
          )}
          <button 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-canvas shrink-0"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-1.5 scrollbar-thin">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isSubActive = item.subItems?.some(sub => location.pathname === sub.path);
            const isDirectActive = location.pathname === item.path;
            const isActive = isDirectActive || isSubActive;

            return (
              <div key={item.name} className="space-y-1">
                {item.subItems ? (
                  // Expandable Outreach item
                  <div>
                    <div 
                      className={`flex items-center w-full px-3 py-2 text-xs font-heading font-medium rounded-btn transition-colors group cursor-pointer ${
                        isActive 
                          ? 'bg-brand-primary/5 text-brand-primary' 
                          : 'text-text-secondary hover:bg-bg-canvas hover:text-text-primary'
                      }`}
                    >
                      <Icon className={`w-4.5 h-4.5 shrink-0 ${sidebarCollapsed ? 'mx-auto' : 'mr-3'}`} />
                      {!sidebarCollapsed && (
                        <>
                          <span className="flex-1 text-left">{item.name}</span>
                          <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isActive ? 'rotate-90 text-brand-primary' : 'text-text-tertiary group-hover:text-text-primary'}`} />
                        </>
                      )}
                    </div>

                    {/* Submenu items */}
                    {!sidebarCollapsed && (
                      <div className="pl-7 mt-1.5 space-y-1 border-l border-border-subtle ml-5">
                        {item.subItems.map((sub) => {
                          const isSubItemActive = location.pathname === sub.path;
                          return (
                            <Link
                              key={sub.name}
                              to={sub.path}
                              className={`flex items-center justify-between px-3 py-1.5 text-xs font-heading font-medium rounded-btn transition-colors ${
                                isSubItemActive
                                  ? 'text-brand-primary font-semibold'
                                  : 'text-text-secondary hover:text-text-primary'
                              }`}
                            >
                              <span>{sub.name}</span>
                              {sub.badge !== undefined && sub.badge > 0 && (
                                <span className="bg-status-danger text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full font-sans tabular-nums animate-pulse">
                                  {sub.badge}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  // Standard item
                  <Link
                    to={item.path}
                    className={`flex items-center px-3 py-2 text-xs font-heading font-medium rounded-btn transition-colors ${
                      isDirectActive 
                        ? 'bg-brand-primary/5 text-brand-primary font-semibold' 
                        : 'text-text-secondary hover:bg-bg-canvas hover:text-text-primary'
                    }`}
                  >
                    <Icon className={`w-4.5 h-4.5 shrink-0 ${sidebarCollapsed ? 'mx-auto' : 'mr-3'}`} />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom items */}
        <div className="p-2 border-t border-border-subtle space-y-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center px-3 py-2 text-xs font-heading font-medium rounded-btn transition-colors ${
                  isActive 
                    ? 'bg-brand-primary/5 text-brand-primary font-semibold' 
                    : 'text-text-secondary hover:bg-bg-canvas hover:text-text-primary'
                }`}
              >
                <Icon className={`w-4.5 h-4.5 shrink-0 ${sidebarCollapsed ? 'mx-auto' : 'mr-3'}`} />
                {!sidebarCollapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
        </div>
      </aside>

      {/* 2. MAIN APP CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 relative z-20">
        
        {/* TOP BAR */}
        <header className="h-14 bg-bg-surface border-b border-border-subtle px-6 flex items-center justify-between shrink-0">
          
          {/* Left section: Workspace selector */}
          <div className="flex items-center space-x-4">
            <div className="relative">
              <button
                onClick={() => setWorkspaceDropdownOpen(!workspaceDropdownOpen)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-btn hover:bg-bg-canvas border border-border-subtle bg-bg-surface text-xs font-heading font-semibold text-text-primary transition"
              >
                <span>Workspace: {activeWorkspace?.name || '—'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
              </button>
              {workspaceDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setWorkspaceDropdownOpen(false)} />
                  <div className="absolute left-0 mt-1.5 w-56 bg-bg-surface-raised border border-border-default rounded-card shadow-lg p-1.5 z-20 animate-in fade-in slide-in-from-top-1 duration-100">
                    {workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => handleSwitchWorkspace(ws.id)}
                        className={`w-full text-left px-2.5 py-1.5 text-xs font-heading font-medium rounded-btn transition ${
                          activeWorkspaceId === ws.id
                            ? 'bg-brand-primary/5 text-brand-primary font-semibold'
                            : 'text-text-secondary hover:bg-bg-canvas hover:text-text-primary'
                        }`}
                      >
                        {ws.name}
                      </button>
                    ))}
                    {canManageWorkspaces && (
                      <button
                        onClick={() => {
                          setWorkspaceDropdownOpen(false);
                          setCreateWorkspaceOpen(true);
                        }}
                        className="w-full flex items-center gap-1.5 text-left px-2.5 py-1.5 text-xs font-heading font-semibold text-brand-primary hover:bg-bg-canvas rounded-btn transition mt-1 pt-1.5 border-t border-border-subtle"
                      >
                        <Plus className="w-3.5 h-3.5" /> Create workspace
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Quick hotkey reminder */}
            <div className="hidden md:flex items-center space-x-1.5 text-xs text-text-tertiary font-heading">
              <span>Press</span>
              <kbd className="h-5 select-none items-center gap-0.5 rounded border border-border-default bg-bg-canvas px-1.5 font-mono text-[10px] font-medium text-text-secondary">
                ⌘K
              </kbd>
              <span>to search</span>
            </div>
          </div>

          {/* Right section: Global Actions */}
          <div className="flex items-center space-x-4">
            
            {/* Search command shortcut */}
            <button 
              onClick={() => setCommandPaletteOpen(true)}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-canvas rounded-full transition md:hidden"
            >
              <Search className="w-4.5 h-4.5" />
            </button>

            {/* Live Message Approval Badge (Core workflow anchor!) */}
            <Link 
              to="/outreach/approval"
              className="relative flex items-center space-x-1 px-3 py-1.5 bg-status-danger-bg hover:bg-red-200/40 text-status-danger border border-status-danger/25 rounded-btn text-xs font-heading font-bold transition animate-pulse"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-status-danger" />
              <span>{pendingApprovalsCount} Pending Sends</span>
            </Link>

            {/* Theme switcher */}
            <button 
              onClick={toggleTheme}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-canvas rounded-full transition"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
            </button>

            {/* Notification bell */}
            <button 
              onClick={() => setNotifCenterOpen(true)}
              className="relative p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-canvas rounded-full transition"
            >
              <Bell className="w-4.5 h-4.5" />
              {unreadNotificationCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-brand-primary border-2 border-bg-surface rounded-full" />
              )}
            </button>

            {/* User Dropdown */}
            {currentUser && (
              <div className="relative">
                <button 
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center space-x-2 p-1.5 rounded-btn hover:bg-bg-canvas transition"
                >
                  <Avatar
                    src={currentUser.avatarUrl}
                    name={currentUser.name}
                    size="sm"
                  />
                  <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
                </button>
                {userDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setUserDropdownOpen(false)} />
                    <div className="absolute right-0 mt-1.5 w-52 bg-bg-surface-raised border border-border-default rounded-card shadow-lg p-2 z-20 animate-in fade-in slide-in-from-top-1 duration-100">
                      <div className="px-2.5 py-1.5 border-b border-border-subtle pb-2 mb-1.5">
                        <span className="text-xs font-heading font-semibold text-text-primary block leading-none">{currentUser.name}</span>
                        <span className="text-[10px] text-text-secondary block mt-1 leading-none">{currentUser.email}</span>
                        <span className="text-[9px] font-heading font-medium text-brand-accent uppercase mt-2 block leading-none">{currentUser.role}</span>
                      </div>
                      
                      <Link 
                        to="/settings"
                        onClick={() => setUserDropdownOpen(false)}
                        className="w-full text-left px-2.5 py-1.5 text-xs font-heading font-medium text-text-secondary hover:text-text-primary hover:bg-bg-canvas rounded-btn block"
                      >
                        Workspace Settings
                      </Link>

                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-2.5 py-1.5 text-xs font-heading font-medium text-status-danger hover:bg-status-danger-bg rounded-btn flex items-center space-x-2 mt-1.5 pt-1.5 border-t border-border-subtle"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Logout</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {/* PAGE CONTENT ROUTER PORTAL */}
        {/* Keyed on the active workspace so switching forces every page's
            mount-time fetch to re-run against the new workspace, without
            needing to touch each page's own data-fetching effect. */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <div key={activeWorkspaceId || 'no-workspace'} className="space-y-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Create workspace modal */}
      <Modal
        isOpen={createWorkspaceOpen}
        onClose={() => setCreateWorkspaceOpen(false)}
        title="Create a new workspace"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-text-secondary">
            A new workspace starts completely empty — its own leads, jobs, templates, messages, and integrations, isolated from every other workspace in your organization.
          </p>
          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1.5">Workspace name</label>
            <input
              type="text"
              autoFocus
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="e.g. EU Outbound"
              className="px-3 py-2 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>
          <div className="flex justify-end space-x-2 border-t border-border-subtle pt-3">
            <Button variant="secondary" size="sm" onClick={() => setCreateWorkspaceOpen(false)} disabled={creatingWorkspace}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleCreateWorkspace} loading={creatingWorkspace}>Create workspace</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
