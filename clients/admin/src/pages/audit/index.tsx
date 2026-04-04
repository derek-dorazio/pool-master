import { useState } from 'react';
import { Download, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuditLog, type AuditFilters } from '@/hooks/use-audit-api';

const ADMINS = ['All', 'sarah.chen@poolmaster.io', 'mike.johnson@poolmaster.io', 'admin@poolmaster.io'];
const ACTIONS = ['All', 'tenant.suspend', 'tenant.update', 'user.merge', 'user.ban', 'contest.recalculate', 'contest.cancel', 'flags.edit', 'announcement.create', 'announcement.update'];
const RESOURCE_TYPES = ['All', 'TENANT', 'USER', 'CONTEST', 'FLAG', 'ANNOUNCEMENT'];

function resourceTypeClass(type: string): string {
  switch (type) {
    case 'TENANT':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'USER':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'CONTEST':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'FLAG':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'ANNOUNCEMENT':
      return 'bg-teal-100 text-teal-800 border-teal-200';
    default:
      return '';
  }
}

export function Component() {
  const [filters, setFilters] = useState<AuditFilters>({
    admin: 'All',
    action: 'All',
    resourceType: 'All',
    dateFrom: '',
    dateTo: '',
    search: '',
    page: 1,
  });
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data, isLoading } = useAuditLog(filters);

  function updateFilter(key: keyof AuditFilters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, ...(key !== 'page' ? { page: 1 } : {}) }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Admin</label>
              <select
                className="flex h-10 w-52 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filters.admin}
                onChange={(e) => updateFilter('admin', e.target.value)}
              >
                {ADMINS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Action</label>
              <select
                className="flex h-10 w-48 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filters.action}
                onChange={(e) => updateFilter('action', e.target.value)}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Resource Type</label>
              <select
                className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filters.resourceType}
                onChange={(e) => updateFilter('resourceType', e.target.value)}
              >
                {RESOURCE_TYPES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Date From</label>
              <Input
                type="date"
                className="w-40"
                value={filters.dateFrom}
                onChange={(e) => updateFilter('dateFrom', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Date To</label>
              <Input
                type="date"
                className="w-40"
                value={filters.dateTo}
                onChange={(e) => updateFilter('dateTo', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="w-56 pl-8"
                  placeholder="Search description or reason..."
                  value={filters.search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !data || data.entries.length === 0 ? (
            <p className="text-muted-foreground">No audit entries found.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-2 font-medium w-8" />
                      <th className="pb-2 pr-4 font-medium">Timestamp</th>
                      <th className="pb-2 pr-4 font-medium">Admin</th>
                      <th className="pb-2 pr-4 font-medium">Action</th>
                      <th className="pb-2 pr-4 font-medium">Resource Type</th>
                      <th className="pb-2 pr-4 font-medium">Resource ID</th>
                      <th className="pb-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => {
                      const isExpanded = expandedRow === entry.id;
                      return (
                        <tr key={entry.id} className="group">
                          <td colSpan={7} className="p-0">
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center border-b py-2.5 text-left hover:bg-muted/50"
                              aria-expanded={isExpanded}
                              aria-controls={`audit-entry-${entry.id}`}
                              data-testid={`audit-entry-toggle-${entry.id}`}
                              onClick={() => setExpandedRow(isExpanded ? null : entry.id)}
                            >
                              <div className="w-8 flex-shrink-0 px-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="w-[140px] flex-shrink-0 pr-4 text-xs">
                                {new Date(entry.timestamp).toLocaleString()}
                              </div>
                              <div className="w-[200px] flex-shrink-0 pr-4 text-xs truncate">
                                {entry.admin}
                              </div>
                              <div className="w-[150px] flex-shrink-0 pr-4 font-mono text-xs">
                                {entry.action}
                              </div>
                              <div className="w-[120px] flex-shrink-0 pr-4">
                                <Badge className={cn('text-xs', resourceTypeClass(entry.resourceType))}>
                                  {entry.resourceType}
                                </Badge>
                              </div>
                              <div className="w-[100px] flex-shrink-0 pr-4 font-mono text-xs truncate">
                                {entry.resourceId}
                              </div>
                              <div className="min-w-0 flex-1 truncate">{entry.description}</div>
                            </button>
                            {isExpanded && (
                              <div
                                id={`audit-entry-${entry.id}`}
                                className="border-b bg-muted/30 px-10 py-4 space-y-3"
                              >
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Full Description</p>
                                  <p className="text-sm">{entry.description}</p>
                                </div>
                                {entry.reason && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Reason</p>
                                    <p className="text-sm">{entry.reason}</p>
                                  </div>
                                )}
                                {entry.beforeState && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Before State</p>
                                    <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
                                      {JSON.stringify(entry.beforeState, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                {entry.afterState && (
                                  <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1">After State</p>
                                    <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
                                      {JSON.stringify(entry.afterState, null, 2)}
                                    </pre>
                                  </div>
                                )}
                                <div className="flex gap-8 text-xs text-muted-foreground">
                                  <div>
                                    <span className="font-medium">IP Address:</span> {entry.ipAddress}
                                  </div>
                                  <div>
                                    <span className="font-medium">User Agent:</span> {entry.userAgent}
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Showing {(data.page - 1) * data.pageSize + 1}–
                  {Math.min(data.page * data.pageSize, data.total)} of {data.total} entries
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page <= 1}
                    data-testid="audit-pagination-previous"
                    onClick={() => updateFilter('page', data.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page >= data.totalPages}
                    data-testid="audit-pagination-next"
                    onClick={() => updateFilter('page', data.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
