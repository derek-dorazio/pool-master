import { useState } from 'react';
import { Download, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useErrorLog, type ErrorLogFilters } from '@/hooks/use-health-api';

const SERVICES = ['All', 'API Gateway', 'Auth Service', 'Contest Service', 'Draft Service', 'Scoring Engine', 'Notification Svc', 'Ingestion Worker'];
const SEVERITIES = ['All', 'Error', 'Warning', 'Critical'];

export function Component() {
  const [filters, setFilters] = useState<ErrorLogFilters>({
    service: 'All',
    severity: 'All',
    dateFrom: '',
    dateTo: '',
    page: 1,
  });
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data, isLoading } = useErrorLog(filters);

  function updateFilter(key: keyof ErrorLogFilters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, ...(key !== 'page' ? { page: 1 } : {}) }));
  }

  function severityClass(severity: string): string {
    switch (severity) {
      case 'Critical':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'Error':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'Warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return '';
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Error Log</h1>
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
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Service</label>
              <select
                className="flex h-10 w-44 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filters.service}
                onChange={(e) => updateFilter('service', e.target.value)}
              >
                {SERVICES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Severity</label>
              <select
                className="flex h-10 w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filters.severity}
                onChange={(e) => updateFilter('severity', e.target.value)}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
              <Input
                type="date"
                className="w-40"
                value={filters.dateFrom}
                onChange={(e) => updateFilter('dateFrom', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
              <Input
                type="date"
                className="w-40"
                value={filters.dateTo}
                onChange={(e) => updateFilter('dateTo', e.target.value)}
              />
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
            <p className="text-muted-foreground">No errors found.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-2 font-medium w-8" />
                      <th className="pb-2 pr-4 font-medium">Timestamp</th>
                      <th className="pb-2 pr-4 font-medium">Service</th>
                      <th className="pb-2 pr-4 font-medium">Severity</th>
                      <th className="pb-2 pr-4 font-medium">Error Type</th>
                      <th className="pb-2 pr-4 font-medium">Message</th>
                      <th className="pb-2 pr-4 font-medium">Tenant</th>
                      <th className="pb-2 font-medium">Request ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => {
                      const isExpanded = expandedRow === entry.id;
                      return (
                        <tr key={entry.id} className="group">
                          <td colSpan={8} className="p-0">
                            <div
                              className="flex cursor-pointer items-center border-b py-2.5 hover:bg-muted/50"
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
                              <div className="w-[130px] flex-shrink-0 pr-4">{entry.service}</div>
                              <div className="w-[80px] flex-shrink-0 pr-4">
                                <Badge className={cn('text-xs', severityClass(entry.severity))}>
                                  {entry.severity}
                                </Badge>
                              </div>
                              <div className="w-[140px] flex-shrink-0 pr-4 font-mono text-xs">{entry.errorType}</div>
                              <div className="min-w-0 flex-1 truncate pr-4">{entry.message}</div>
                              <div className="w-[100px] flex-shrink-0 pr-4">{entry.tenant}</div>
                              <div className="w-[110px] flex-shrink-0 font-mono text-xs">{entry.requestId}</div>
                            </div>
                            {isExpanded && (
                              <div className="border-b bg-muted/30 px-10 py-4">
                                <p className="mb-2 text-sm font-medium">Stack Trace</p>
                                <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
                                  {entry.stackTrace}
                                </pre>
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
                  {Math.min(data.page * data.pageSize, data.total)} of {data.total} errors
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page <= 1}
                    onClick={() => updateFilter('page', data.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page >= data.totalPages}
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
