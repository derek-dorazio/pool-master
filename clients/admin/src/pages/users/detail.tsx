import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import { adminApi } from '@/lib/api-client';
import { useUserDetail } from '@/hooks/use-admin-api';

const statusColors: Record<string, string> = {
  Active: 'bg-green-100 text-green-800 border-green-200',
  Disabled: 'bg-red-100 text-red-800 border-red-200',
  Pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};

const tokenColors: Record<string, string> = {
  Valid: 'bg-green-100 text-green-800 border-green-200',
  Expired: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Revoked: 'bg-red-100 text-red-800 border-red-200',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      className="ml-1 inline-flex items-center rounded p-0.5 hover:bg-accent"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

export function Component() {
  const { id } = useParams<{ id: string }>();
  const { data: user, isLoading } = useUserDetail(id);
  const [actionsOpen, setActionsOpen] = useState(false);
  const dialog = useConfirmDialog();

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading user...</p>
      </div>
    );
  }

  async function handleAction(action: string) {
    setActionsOpen(false);
    const confirmed = await dialog.confirm(
      action,
      `Are you sure you want to ${action} for "${user!.displayName}"?`,
      { confirmLabel: action, variant: action === 'Disable Account' ? 'destructive' : 'default' },
    );
    if (confirmed) {
      try {
        await adminApi.post(`/v1/admin/users/${id}/actions`, { action });
      } catch {
        // Silently handle — backend may not be available yet
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{user.displayName}</h1>
          <div className="flex items-center gap-2 text-sm">
            <span>{user.email}</span>
            <CopyButton text={user.email} />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{user.id}</span>
            <CopyButton text={user.id} />
          </div>
          <div className="pt-1">
            <Badge variant="outline" className={statusColors[user.status]}>{user.status}</Badge>
          </div>
        </div>
        <div className="relative">
          <Button variant="outline" onClick={() => setActionsOpen(!actionsOpen)}>
            Actions
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
          {actionsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md">
              <button className="flex w-full rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => handleAction('Reset Password')}>Reset Password</button>
              <button className="flex w-full rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => handleAction('Force Logout')}>Force Logout</button>
              <button className="flex w-full rounded-sm px-3 py-2 text-sm text-destructive hover:bg-accent" onClick={() => handleAction('Disable Account')}>Disable Account</button>
              <button className="flex w-full rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => handleAction('Send Email')}>Send Email</button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tenants">Tenants & Leagues</TabsTrigger>
          <TabsTrigger value="contests">Contests</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="auth">Auth Events</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Profile Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auth Provider</span>
                <span>{user.authProvider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDate(user.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Login</span>
                <span>{formatDate(user.lastLogin)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Locale</span>
                <span>{user.locale}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tenants & Leagues */}
        <TabsContent value="tenants" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tenant Memberships</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Tenant</th>
                    <th className="px-4 py-3 text-left font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {user.tenantMemberships.map((tm) => (
                    <tr key={tm.tenantId} className="border-b">
                      <td className="px-4 py-3 font-medium">{tm.tenantName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{tm.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">League Memberships</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">League</th>
                    <th className="px-4 py-3 text-left font-medium">Sport</th>
                    <th className="px-4 py-3 text-left font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {user.leagueMemberships.map((lm) => (
                    <tr key={lm.leagueId} className="border-b">
                      <td className="px-4 py-3 font-medium">{lm.leagueName}</td>
                      <td className="px-4 py-3">{lm.sport}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{lm.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Contests */}
        <TabsContent value="contests">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Sport</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {user.contests.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3">{c.sport}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn(
                          c.status === 'Active' && 'bg-green-100 text-green-800 border-green-200',
                          c.status === 'Upcoming' && 'bg-blue-100 text-blue-800 border-blue-200',
                          c.status === 'Completed' && 'bg-gray-100 text-gray-800 border-gray-200',
                        )}>{c.status}</Badge>
                      </td>
                      <td className="px-4 py-3">{c.rank > 0 ? `#${c.rank}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Devices */}
        <TabsContent value="devices">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Platform</th>
                    <th className="px-4 py-3 text-left font-medium">Last Active</th>
                    <th className="px-4 py-3 text-left font-medium">Token Status</th>
                  </tr>
                </thead>
                <tbody>
                  {user.devices.map((d) => (
                    <tr key={d.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{d.platform}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(d.lastActive)}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={tokenColors[d.tokenStatus]}>{d.tokenStatus}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Auth Events */}
        <TabsContent value="auth">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                    <th className="px-4 py-3 text-left font-medium">IP Address</th>
                    <th className="px-4 py-3 text-left font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {user.authEvents.map((ae) => (
                    <tr key={ae.id} className="border-b">
                      <td className="px-4 py-3 font-medium capitalize">{ae.type.replace('_', ' ')}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(ae.timestamp)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{ae.ip}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn(
                          ae.success
                            ? 'bg-green-100 text-green-800 border-green-200'
                            : 'bg-red-100 text-red-800 border-red-200',
                        )}>
                          {ae.success ? 'Success' : 'Failed'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={dialog.open}
        title={dialog.title}
        description={dialog.description}
        confirmLabel={dialog.confirmLabel}
        variant={dialog.variant}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
    </div>
  );
}
