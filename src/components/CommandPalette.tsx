import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, Play, Mail, FileText, Settings, Shield } from 'lucide-react';
import { useUiStore } from '../store/useUiStore';
import { getLeads } from '../services/sourcingApi';

interface PaletteLead {
  id: string;
  name: string;
  designation: string;
  company: string;
  score: number | null;
}

export const CommandPalette: React.FC = () => {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUiStore();
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<PaletteLead[]>([]);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      // Real leads from the current workspace, not a static mock array —
      // fetched fresh each time the palette opens so results stay current.
      getLeads({})
        .then((res) => {
          const mapped: PaletteLead[] = (res?.data || []).map((l: any) => ({
            id: l.id,
            name: l.decisionMaker?.full_name || 'Unknown contact',
            designation: l.decisionMaker?.designation || '',
            company: l.company?.name || 'Unknown company',
            score: l.score ?? null,
          }));
          setLeads(mapped);
        })
        .catch(() => setLeads([]));
    }
  }, [commandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  const actions = [
    { name: 'Lead Search', description: 'Define target parameters and scrape', icon: Search, path: '/search' },
    { name: 'Lead Review Table', description: 'Approve or reject scraped leads', icon: User, path: '/leads' },
    { name: 'Message Approval Queue', description: 'Approve messages before sending', icon: Shield, path: '/outreach/approval' },
    { name: 'Outreach Studio', description: 'Compose templates and messages', icon: Mail, path: '/outreach/studio' },
    { name: 'Automated Sequences', description: 'Build visual sequence flows', icon: Play, path: '/outreach/sequences' },
    { name: 'Templates Library', description: 'Manage reusable messages', icon: FileText, path: '/templates' },
    { name: 'Settings', description: 'Workspace and API config', icon: Settings, path: '/settings' },
  ];

  const matchedActions = actions.filter(
    (a) => a.name.toLowerCase().includes(query.toLowerCase()) || a.description.toLowerCase().includes(query.toLowerCase())
  );

  const matchedLeads = leads
    .filter(
      (l) =>
        l.name.toLowerCase().includes(query.toLowerCase()) ||
        l.company.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 4);

  const handleSelectAction = (path: string) => {
    setCommandPaletteOpen(false);
    navigate(path);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setCommandPaletteOpen(false)} />

      {/* Modal Card */}
      <div className="relative bg-bg-surface-raised border border-border-default shadow-lg rounded-modal overflow-hidden max-w-lg w-full flex flex-col z-10 animate-in fade-in zoom-in-95 duration-100">
        {/* Input header */}
        <div className="px-4 py-3.5 border-b border-border-subtle flex items-center space-x-3 bg-bg-surface">
          <Search className="w-5 h-5 text-text-tertiary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads, campaigns, pages or quick actions..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-0.5 rounded border border-border-default bg-bg-canvas px-1.5 font-mono text-[10px] font-medium text-text-secondary">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 max-h-[350px] overflow-y-auto p-2 space-y-3">
          {matchedActions.length > 0 && (
            <div>
              <span className="text-[11px] font-heading font-semibold uppercase tracking-wider text-text-tertiary px-3 py-1.5 block">
                Navigation & Quick Actions
              </span>
              <div className="space-y-0.5">
                {matchedActions.map((act) => {
                  const Icon = act.icon;
                  return (
                    <button
                      key={act.name}
                      onClick={() => handleSelectAction(act.path)}
                      className="w-full flex items-center px-3 py-2 text-left rounded-btn hover:bg-bg-canvas group transition"
                    >
                      <div className="p-1.5 bg-brand-primary/5 text-text-secondary group-hover:text-brand-primary rounded-btn mr-3">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-heading font-medium text-text-primary block">{act.name}</span>
                        <span className="text-xs text-text-secondary block truncate">{act.description}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {matchedLeads.length > 0 && (
            <div>
              <span className="text-[11px] font-heading font-semibold uppercase tracking-wider text-text-tertiary px-3 py-1.5 block">
                Matching Leads
              </span>
              <div className="space-y-0.5">
                {matchedLeads.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => handleSelectAction('/leads')}
                    className="w-full flex items-center px-3 py-2 text-left rounded-btn hover:bg-bg-canvas group transition"
                  >
                    <div className="w-7 h-7 rounded-full bg-brand-primary/5 text-brand-primary flex items-center justify-center font-heading font-bold text-xs mr-3">
                      {lead.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-heading font-medium text-text-primary block">
                        {lead.name}
                      </span>
                      <span className="text-xs text-text-secondary block truncate">
                        {lead.designation} at {lead.company}
                      </span>
                    </div>
                    {lead.score !== null && (
                      <span className="text-xs text-text-tertiary font-heading ml-auto tabular-nums bg-bg-canvas px-1.5 py-0.5 rounded-badge border border-border-subtle">
                        Score: {lead.score}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedActions.length === 0 && matchedLeads.length === 0 && (
            <div className="text-center py-8 text-sm text-text-secondary">
              No results found for "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
