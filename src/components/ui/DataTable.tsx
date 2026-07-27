import React, { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender
} from '@tanstack/react-table';
import type {
  ColumnDef,
  SortingState,
  VisibilityState,
  RowSelectionState
} from '@tanstack/react-table';
import { cn } from '../../utils/cn';
import { 
  ChevronDown, ArrowUpDown, ChevronLeft, ChevronRight, 
  ChevronsLeft, ChevronsRight, Search 
} from 'lucide-react';
import { Button, Skeleton } from './core';

interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  loading?: boolean;
  onRowClick?: (row: TData) => void;
  selectedRows?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  searchPlaceholder?: string;
  searchKey?: string;
  bulkActions?: React.ReactNode;
  emptyState?: React.ReactNode;
}

export function DataTable<TData>({
  columns,
  data,
  loading = false,
  onRowClick,
  selectedRows = {},
  onRowSelectionChange,
  searchPlaceholder = "Search...",
  searchKey,
  bulkActions,
  emptyState
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      globalFilter,
      rowSelection: selectedRows,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: (updater) => {
      if (onRowSelectionChange) {
        const newSelection = typeof updater === 'function' ? updater(selectedRows) : updater;
        onRowSelectionChange(newSelection);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, columnId, filterValue) => {
      const value = row.getValue(columnId);
      if (value == null) return false;
      return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
    }
  });

  const hasSelected = Object.keys(selectedRows).length > 0;

  return (
    <div className="space-y-4">
      {/* Table Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Search */}
        {searchKey && (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9 pr-4 py-2 w-full text-sm bg-bg-surface border border-border-default rounded-input text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
            />
          </div>
        )}

        <div className="flex items-center space-x-2 self-end sm:self-auto ml-auto">
          {/* Column Toggle */}
          <div className="relative group">
            <Button variant="secondary" size="sm" icon={ChevronDown}>
              Columns
            </Button>
            <div className="absolute right-0 mt-1.5 w-48 bg-bg-surface-raised border border-border-default rounded-card shadow-lg p-2 hidden group-focus-within:block group-hover:block z-20">
              <span className="text-[11px] font-heading font-semibold uppercase tracking-wider text-text-tertiary px-2.5 py-1.5 block">Toggle Columns</span>
              <div className="max-h-48 overflow-y-auto space-y-1 mt-1">
                {table.getAllLeafColumns().map((column) => {
                  if (column.id === 'select' || column.id === 'actions') return null;
                  return (
                    <label
                      key={column.id}
                      className="flex items-center px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-canvas rounded-btn cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={column.getIsVisible()}
                        onChange={(e) => column.toggleVisibility(!!e.target.checked)}
                        className="mr-2 rounded border-border-default text-brand-primary focus:ring-brand-primary"
                      />
                      <span className="capitalize">{column.id.replace(/([A-Z])/g, ' $1')}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk Action Sticky Bar */}
      {hasSelected && bulkActions && (
        <div className="sticky bottom-4 left-0 right-0 z-30 bg-brand-primary text-white py-3 px-5 rounded-card shadow-lg flex items-center justify-between border border-brand-primary-hover animate-in fade-in slide-in-from-bottom-2 duration-200">
          <span className="text-sm font-heading font-medium">
            {Object.keys(selectedRows).length} lead{Object.keys(selectedRows).length > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center space-x-3">
            {bulkActions}
          </div>
        </div>
      )}

      {/* Main Table Content */}
      <div className="border border-border-subtle rounded-card bg-bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-bg-canvas border-b border-border-default text-xs font-heading font-semibold uppercase tracking-wider text-text-secondary">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="py-3.5 px-4 font-semibold text-text-secondary select-none"
                      style={{ width: header.column.columnDef.size }}
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          className={cn(
                            "flex items-center space-x-1.5",
                            header.column.getCanSort() && "cursor-pointer hover:text-text-primary"
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            <ArrowUpDown className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
                          )}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {loading ? (
                // Skeletons
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx} className="bg-bg-surface">
                    {columns.map((_, colIdx) => (
                      <td key={colIdx} className="py-4 px-4">
                        <Skeleton className="h-4 w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="py-8">
                    {emptyState || (
                      <div className="text-center text-text-secondary py-6 text-sm">
                        No rows found.
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick && onRowClick(row.original)}
                    className={cn(
                      "bg-bg-surface hover:bg-bg-canvas/50 transition-colors duration-100",
                      onRowClick && "cursor-pointer"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="py-3.5 px-4 text-sm text-text-primary align-middle"
                        onClick={(e) => {
                          // Prevent row click if clicking checkbox or action button
                          if (cell.column.id === 'select' || cell.column.id === 'actions') {
                            e.stopPropagation();
                          }
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {!loading && table.getRowModel().rows.length > 0 && (
          <div className="px-4 py-3.5 border-t border-border-subtle bg-bg-canvas/30 flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-xs text-text-secondary font-heading tabular-nums">
              Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
              {Math.min(
                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                table.getFilteredRowModel().rows.length
              )}{' '}
              of {table.getFilteredRowModel().rows.length} records
            </span>
            <div className="flex items-center space-x-6">
              {/* Page size selector */}
              <div className="flex items-center space-x-2">
                <span className="text-xs text-text-secondary font-heading">Rows per page:</span>
                <select
                  value={table.getState().pagination.pageSize}
                  onChange={(e) => table.setPageSize(Number(e.target.value))}
                  className="bg-bg-surface border border-border-default text-text-primary text-xs rounded-btn py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                >
                  {[10, 20, 30, 40, 50].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
              {/* Arrows */}
              <div className="flex items-center space-x-1">
                <Button
                  variant="secondary"
                  size="icon"
                  className="w-8 h-8"
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="w-8 h-8"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-text-primary font-heading font-medium tabular-nums px-2">
                  Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                </span>
                <Button
                  variant="secondary"
                  size="icon"
                  className="w-8 h-8"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="w-8 h-8"
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
