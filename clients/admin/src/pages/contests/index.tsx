import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trophy, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContestList } from '@/hooks/use-contests-api';
import type { ContestFilters } from '@/hooks/use-contests-api';

const STATUSES = ['All', 'draft', 'open', 'active', 'completed', 'cancelled'];
const TYPES = ['All', 'Single Event', 'Season Long'];

const PAGE_SIZE = 5;

function statusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'open': return 'bg-blue-100 text-blue-800';
    case 'draft':
    case 'drafting': return 'bg-yellow-100 text-yellow-800';
    case 'active': return 'bg-green-100 text-green-800';
    case 'completed': return 'bg-gray-100 text-gray-800';
    case 'cancelled': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function contestTypeLabel(contestType: string): string {
  return contestType === 'SINGLE_EVENT' ? 'Single Event' : 'Season Long';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

export function Component() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ContestFilters>({
    tenant: 'All',
    sport: 'All',
    status: 'All',
    type: 'All',
  });
  const [page, setPage] = useState(0);
  const { data: contests = [] } = useContestList(filters);
  const tenantOptions = ['All', ...Array.from(new Set(contests.map((contest) => contest.tenantName)))];
  const sportOptions = ['All', ...Array.from(new Set(contests.map((contest) => contest.sport)))];

  const totalPages = Math.max(1, Math.ceil(contests.length / PAGE_SIZE));
  const paged = contests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function updateFilter(key: keyof ContestFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Trophy className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Contest Browser</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <FilterSelect label="Tenant" value={filters.tenant ?? 'All'} options={tenantOptions} onChange={(v) => updateFilter('tenant', v)} />
            <FilterSelect label="Sport" value={filters.sport ?? 'All'} options={sportOptions} onChange={(v) => updateFilter('sport', v)} />
            <FilterSelect label="Status" value={filters.status ?? 'All'} options={STATUSES} onChange={(v) => updateFilter('status', v)} />
            <FilterSelect label="Contest Type" value={filters.type ?? 'All'} options={TYPES} onChange={(v) => updateFilter('type', v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Contest Name</th>
                  <th className="px-4 py-3 text-left font-medium">League</th>
                  <th className="px-4 py-3 text-left font-medium">Tenant</th>
                  <th className="px-4 py-3 text-left font-medium">Sport</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Selection</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Entries</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => navigate(`/contests/${c.id}`)}
                  >
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.leagueName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.tenantName}</td>
                    <td className="px-4 py-3">{c.sport}</td>
                    <td className="px-4 py-3">{contestTypeLabel(c.contestType)}</td>
                    <td className="px-4 py-3">{c.selectionType}</td>
                    <td className="px-4 py-3">
                      <Badge className={cn('text-xs', statusColor(c.status))}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">{c.entryCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No contests match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {paged.length} of {contests.length} contests
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
