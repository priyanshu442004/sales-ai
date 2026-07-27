import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Card, Badge, Modal } from '../components/ui/core';
import { Plus, Trash2, Edit3, Copy, Search, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { listTemplates, saveTemplate, deleteTemplate } from '../services/sourcingApi';
import type { TemplateRecord } from '../services/sourcingApi';

const TYPES: TemplateRecord['type'][] = ['Cold Email', 'LinkedIn Connection Note', 'Follow-up', 'Proposal'];

function typeBadgeVariant(type: TemplateRecord['type']): 'neutral' | 'info' | 'warning' | 'success' {
  switch (type) {
    case 'LinkedIn Connection Note': return 'info';
    case 'Follow-up': return 'warning';
    case 'Proposal': return 'success';
    default: return 'neutral';
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never used';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const Templates: React.FC = () => {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TemplateRecord['type'] | 'all'>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<TemplateRecord['type']>('Cold Email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTemplates();
      setTemplates(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q));
      }
      return true;
    });
  }, [templates, search, typeFilter]);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setType('Cold Email');
    setSubject('');
    setBody('');
    setTagsInput('');
    setModalOpen(true);
  };

  const openEdit = (t: TemplateRecord) => {
    setEditingId(t.id);
    setName(t.name);
    setType(t.type);
    setSubject(t.subject || '');
    setBody(t.body);
    setTagsInput(t.tags.join(', '));
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Template name is required.');
      return;
    }
    if (!body.trim()) {
      toast.error('Message body is required.');
      return;
    }

    setSaving(true);
    try {
      const tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean);
      await saveTemplate({
        id: editingId || undefined,
        name: name.trim(),
        type,
        subject: type === 'LinkedIn Connection Note' ? null : subject.trim() || null,
        body,
        tags,
      });
      toast.success(editingId ? 'Template updated.' : 'Template saved to library.');
      setModalOpen(false);
      fetchTemplates();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t: TemplateRecord) => {
    setDeletingId(t.id);
    try {
      await deleteTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast.success('Template removed.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete template.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopy = async (t: TemplateRecord) => {
    const text = t.subject ? `Subject: ${t.subject}\n\n${t.body}` : t.body;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        t.channel === 'linkedin'
          ? 'Copied — paste it into a LinkedIn connection request.'
          : 'Copied — paste it when composing from the Job Queue, or pick it there from "Start from a template".'
      );
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Templates library</h1>
          <p className="text-xs text-text-secondary mt-1">Reusable cold email, LinkedIn note, follow-up, and proposal drafts — pick one when composing from the Job Queue.</p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> New template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="pl-8 pr-3 py-1.5 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTypeFilter('all')}
            className={`text-xs px-2.5 py-1 rounded-badge border transition ${typeFilter === 'all' ? 'bg-brand-primary text-white border-brand-primary' : 'bg-bg-canvas text-text-secondary border-border-default hover:border-brand-primary'}`}
          >
            All
          </button>
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`text-xs px-2.5 py-1 rounded-badge border transition ${typeFilter === t ? 'bg-brand-primary text-white border-brand-primary' : 'bg-bg-canvas text-text-secondary border-border-default hover:border-brand-primary'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-secondary text-xs">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading templates...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary">
          <FileText className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-heading font-semibold text-text-secondary">
            {templates.length === 0 ? 'No templates yet' : 'No templates match your search'}
          </p>
          <p className="text-xs mt-1">
            {templates.length === 0 ? 'Create your first reusable outreach draft.' : 'Try a different search term or type filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((t) => (
            <Card key={t.id} className="p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
                  <span className="text-sm font-heading font-bold text-text-primary">{t.name}</span>
                  <Badge variant={typeBadgeVariant(t.type)}>{t.type}</Badge>
                </div>

                {t.subject && (
                  <div className="text-xs font-mono bg-bg-canvas border border-border-subtle px-2 py-1 rounded text-text-primary mt-3">
                    Subject: {t.subject}
                  </div>
                )}

                <pre className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed font-sans bg-bg-canvas/30 p-3.5 border border-border-subtle rounded-card mt-3 max-h-40 overflow-y-auto">
                  {t.body}
                </pre>

                {t.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2.5">
                    {t.tags.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded border border-border-default text-text-tertiary">{tag}</span>
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-text-tertiary mt-3">
                  {t.usageCount > 0 ? `Used ${t.usageCount} time${t.usageCount === 1 ? '' : 's'} · last ${timeAgo(t.lastUsedAt)}` : 'Never used'}
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-border-subtle">
                <Button variant="ghost" size="sm" className="text-xs text-status-error px-2 h-8" onClick={() => handleDelete(t)} loading={deletingId === t.id}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="text-xs px-2.5 h-8" onClick={() => handleCopy(t)}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                </Button>
                <Button variant="secondary" size="sm" className="text-xs px-2.5 h-8" onClick={() => openEdit(t)}>
                  <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit template' : 'New template'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Template name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TemplateRecord['type'])}
              className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {type !== 'LinkedIn Connection Note' && (
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Message body</label>
            <textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="p-3 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
            <p className="text-[11px] text-text-tertiary mt-1.5">
              Use {'{{first_name}}'}, {'{{company}}'} and {'{{title}}'} — they're replaced with each recipient's real details when the template is used.
            </p>
          </div>

          <div>
            <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Tags (comma separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Cold Outreach, SaaS"
              className="px-3 py-2 w-full text-xs bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
          </div>

          <div className="flex justify-end space-x-2 border-t border-border-subtle pt-3">
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>Save template</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
