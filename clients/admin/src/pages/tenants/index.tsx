import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useTenantList, type TenantFilters } from '@/hooks/use-admin-api';

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const planColors: Record<string, string> = {
  Free: 'bg-gray-100 text-gray-800 border-gray-200',
  Starter: 'bg-blue-100 text-blue-800 border-blue-200',
  Pro: 'bg-purple-100 text-purple-800 border-purple-200',
  'League+': 'bg-amber-100 text-amber-800 border-amber-200',
};

const statusColors: Record<string, string> = {
  Active: 'bg-green-100 text-green-800 border-green-200',
  Suspended: 'bg-red-100 text-red-800 border-red-200',
  Trial: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};

const sortableColumns = ['name', 'plan', 'members', 'leagues', 'contests', 'status', 'lastActive'] as const;

export function Component() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<TenantFilters>({
    search: '',
    plan: 'All',
    status: 'All',
    page: 1,
    pageSize: 10,
    sortBy: 'name',
    sortDir: 'asc',
  });

  const { data, isLoading } = useTenantList(filters);

  function handleSort(col: string) {
    setFilters((prev) => ({
      ...prev,
      sortBy: col,
      sortDir: prev.sortBy === col && prev.sortDir === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Tenants</h1>
        {data && (
          <Badge variant="secondary">{data.total} total</Badge>
        )}
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tenants..."
              className="pl-9"
              value={filters.search}
              onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value, page: 1 }))}
            />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={filters.plan}
            onChange={(e) => setFilters((p) => ({ ...p, plan: e.target.value, page: 1 }))}
          >
            <option value="All">All Plans</option>
            <option value="Free">Free</option>
            <option value="Starter">Starter</option>
            <option value="Pro">Pro</option>
            <option value="League+">League+</option>
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={filters.status}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value, page: 1 }))}
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Suspended">Suspended</option>
            <option value="Trial">Trial</option>
          </select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {sortableColumns.map((col) => (
                  <th key={col} className="px-4 py-3 text-left font-medium">
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => handleSort(col)}
                    >
                      {col === 'lastActive' ? 'Last Active' : col.charAt(0).toUpperCase() + col.slice(1)}
                      <ArrowUpDown className={cn(
                        'h-3 w-3',
                        filters.sortBy === col ? 'text-foreground' : 'text-muted-foreground/50',
                      )} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No tenants found
                  </td>
                </tr>
              ) : (
                data?.items.map((t) => (
                  <tr
                    key={t.id}
                    className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                    onClick={() => navigate(`/tenants/${t.id}`)}
                  >
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={planColors[t.plan]}>{t.plan}</Badge>
                    </td>
                    <td className="px-4 py-3">{t.members}</td>
                    <td className="px-4 py-3">{t.leagues}</td>
                    <td className="px-4 py-3">{t.contests}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={statusColors[t.status]}>{t.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelativeTime(t.lastActive)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={filters.pageSize}
                onChange={(e) => setFilters((p) => ({ ...p, pageSize: Number(e.target.value), page: 1 }))}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={25}>25</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Page {data.page} of {data.totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={data.page <= 1}
                onClick={() => setFilters((p) => ({ ...p, page: (p.page ?? 1) - 1 }))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={data.page >= data.totalPages}
                onClick={() => setFilters((p) => ({ ...p, page: (p.page ?? 1) + 1 }))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
