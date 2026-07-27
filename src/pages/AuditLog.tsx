import React, { useEffect, useState, useCallback } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge, Drawer } from '../components/ui/core';
import { DataTable } from '../components/ui/DataTable';
import { getAuditLogs } from '../services/sourcingApi';
import type { AuditLogEntry } from '../types/api';
import { FileCode, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAuditLogs();
      setLogs(res?.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getCategoryBadge = (category?: AuditLogEntry['category']) => {
    if (!category) return <Badge variant="neutral">System</Badge>;
    switch (category) {
      case 'AUTH':
        return <Badge variant="neutral">Authentication</Badge>;
      case 'SCRAPE':
        return <Badge variant="info">Scrape Job</Badge>;
      case 'OUTBOUND':
        return <Badge variant="success">Outbound Sent</Badge>;
      case 'WORKSPACE':
        return <Badge variant="warning">Workspace Config</Badge>;
      case 'SCORING':
        return <Badge variant="warning">Scoring Weights</Badge>;
      default:
        return <Badge variant="neutral">{category}</Badge>;
    }
  };

  const columns: ColumnDef<AuditLogEntry>[] = [
    {
      id: 'timestamp',
      header: 'Timestamp',
      accessorKey: 'timestamp',
      cell: ({ row }) => (
        <span className="font-mono text-text-secondary tabular-nums text-[11px]">
          {new Date(row.original.timestamp).toLocaleString()}
        </span>
      )
    },
    {
      id: 'actor',
      header: 'Actor',
      accessorKey: 'actorName',
      cell: ({ row }) => (
        <span className="font-heading font-semibold text-text-primary">
          {row.original.actorName}
        </span>
      )
    },
    {
      id: 'category',
      header: 'Category',
      accessorKey: 'category',
      cell: ({ row }) => getCategoryBadge(row.original.category)
    },
    {
      id: 'action',
      header: 'Action / Description',
      accessorKey: 'action',
      cell: ({ row }) => (
        <span className="text-text-secondary font-medium block max-w-sm truncate">
          {row.original.action}
        </span>
      )
    },
    {
      id: 'ipAddress',
      header: 'IP Address',
      accessorKey: 'ipAddress',
      cell: ({ row }) => (
        <span className="font-mono text-[10px] text-text-tertiary">
          {row.original.ipAddress}
        </span>
      )
    }
  ];

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-text-primary">Compliance Audit Log</h1>
          <p className="text-xs text-text-secondary mt-1">Audit security records, state changes, scraper runs, and team authorization traces.</p>
        </div>
        <div className="flex items-center space-x-2 bg-bg-canvas px-3 py-1.5 rounded-btn border border-border-subtle text-xs text-text-secondary font-heading font-medium">
          <ShieldCheck className="w-4 h-4 text-brand-primary mr-1" />
          <span>SOC2 Compliant Logs</span>
        </div>
      </div>

      {/* Main logs DataTable */}
      <DataTable
        columns={columns}
        data={logs}
        loading={loading}
        searchKey="action"
        searchPlaceholder="Filter by action keyword..."
        onRowClick={(row) => setSelectedLog(row)}
      />

      {/* Detail drawer showing raw JSON payload */}
      <Drawer
        isOpen={selectedLog !== null}
        onClose={() => setSelectedLog(null)}
        title={selectedLog ? `Audit Event Details` : ''}
      >
        {selectedLog && (
          <div className="space-y-6">
            
            {/* Summary details */}
            <div className="p-4 bg-bg-canvas rounded-card border border-border-subtle space-y-2.5 text-xs text-text-secondary">
              <div className="flex justify-between">
                <span>Timestamp:</span>
                <span className="font-mono text-text-primary">{new Date(selectedLog.timestamp).toISOString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Device:</span>
                <span className="font-semibold text-text-primary">{selectedLog.deviceMetadata}</span>
              </div>
              <div className="flex justify-between">
                <span>IP Address:</span>
                <span className="font-mono text-text-primary">{selectedLog.ipAddress}</span>
              </div>
              <div className="flex justify-between">
                <span>Target:</span>
                <span className="font-mono text-text-primary font-bold">{selectedLog.targetEntityName}</span>
              </div>
            </div>

            {/* Raw event payload — every field here comes straight from the
                audit_log table, nothing fabricated. */}
            <div className="space-y-2">
              <div className="flex items-center space-x-1.5">
                <FileCode className="w-4.5 h-4.5 text-brand-primary" />
                <h4 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">Raw event record</h4>
              </div>
              <pre className="bg-text-primary text-green-400 font-mono text-[11px] p-4 rounded-card overflow-x-auto shadow-inner border border-border-default select-text">
                {JSON.stringify(
                  {
                    id: selectedLog.id,
                    category: selectedLog.category,
                    timestamp: selectedLog.timestamp,
                    actor: selectedLog.actorName,
                    actorEmail: selectedLog.actorEmail,
                    action: selectedLog.action,
                    targetEntityName: selectedLog.targetEntityName,
                    ipAddress: selectedLog.ipAddress,
                    deviceMetadata: selectedLog.deviceMetadata,
                  },
                  null,
                  2
                )}
              </pre>
            </div>

          </div>
        )}
      </Drawer>
    </div>
  );
};
