import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useUserSearch } from '@/hooks/use-admin-api';

const statusColors: Record<string, string> = {
  Active: 'bg-green-100 text-green-800 border-green-200',
  Disabled: 'bg-red-100 text-red-800 border-red-200',
  Pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Component() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { data: users, isLoading, isFetched } = useUserSearch(query);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">User Search</h1>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-12 pl-12 text-base"
          placeholder="Search by email, name, user ID, or tenant..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Results */}
      {!query ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">Enter a search term to find users across all tenants</p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground">Searching...</p>
        </div>
      ) : isFetched && users && users.length > 0 ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Display Name</th>
                  <th className="px-4 py-3 text-left font-medium">Tenant(s)</th>
                  <th className="px-4 py-3 text-left font-medium">Last Login</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                    onClick={() => navigate(`/users/${u.id}`)}
                  >
                    <td className="px-4 py-3">{u.email}</td>
                    <td className="px-4 py-3 font-medium">{u.displayName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.tenants.join(', ')}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(u.lastLogin)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn(statusColors[u.status])}>{u.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : isFetched ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground">No users found for &quot;{query}&quot;</p>
        </div>
      ) : null}
    </div>
  );
}
