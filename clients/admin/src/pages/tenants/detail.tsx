import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  client,
  adminSuspendTenant,
  adminChangeTenantPlan,
  adminApplyCredit,
  adminExtendTrial,
  adminDeleteTenant,
} from '@/lib/api';
import { useTenantDetail } from '@/hooks/use-admin-api';

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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

function ProgressBar({ current, limit, label }: { current: number; limit: number; label: string }) {
  const pct = Math.min((current / limit) * 100, 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{current} / {limit}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={cn(
            'h-2 rounded-full transition-all',
            pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Component() {
  const { id } = useParams<{ id: string }>();
  const { data: tenant, isLoading } = useTenantDetail(id);
  const [actionsOpen, setActionsOpen] = useState(false);
  const dialog = useConfirmDialog();

  if (isLoading || !tenant) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading tenant...</p>
      </div>
    );
  }

  async function handleAction(action: string) {
    setActionsOpen(false);
    const confirmed = await dialog.confirm(
      action,
      `Are you sure you want to ${action} for "${tenant!.name}"?`,
      { confirmLabel: action, variant: action === 'Delete' ? 'destructive' : 'default' },
    );
    if (confirmed && id) {
      switch (action) {
        case 'Suspend':
          await adminSuspendTenant({ client, path: { tenantId: id }, body: { reason: 'Admin action' } });
          break;
        case 'Change Plan':
          await adminChangeTenantPlan({ client, path: { tenantId: id }, body: { planTier: 'Pro', reason: 'Admin action' } });
          break;
        case 'Apply Credit':
          await adminApplyCredit({ client, path: { tenantId: id }, body: { amount: 0, reason: 'Admin action' } });
          break;
        case 'Extend Trial':
          await adminExtendTrial({ client, path: { tenantId: id }, body: { days: 30, reason: 'Admin action' } });
          break;
        case 'Delete':
          await adminDeleteTenant({ client, path: { tenantId: id }, body: { confirmation: tenant!.name } });
          break;
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{tenant.name}</h1>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={planColors[tenant.plan]}>{tenant.plan}</Badge>
            <Badge variant="outline" className={statusColors[tenant.status]}>{tenant.status}</Badge>
            <span className="text-sm text-muted-foreground">Created {formatDate(tenant.createdAt)}</span>
          </div>
        </div>
        <div className="relative">
          <Button variant="outline" onClick={() => setActionsOpen(!actionsOpen)}>
            Actions
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
          {actionsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md">
              <button className="flex w-full rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => handleAction('Change Plan')}>Change Plan</button>
              <button className="flex w-full rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => handleAction('Suspend')}>Suspend</button>
              <button className="flex w-full rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => handleAction('Apply Credit')}>Apply Credit</button>
              <button className="flex w-full rounded-sm px-3 py-2 text-sm hover:bg-accent" onClick={() => handleAction('Extend Trial')}>Extend Trial</button>
              <button className="flex w-full rounded-sm px-3 py-2 text-sm text-destructive hover:bg-accent" onClick={() => handleAction('Delete')}>Delete</button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="leagues">Leagues</TabsTrigger>
          <TabsTrigger value="contests">Contests</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tenant Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{tenant.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Slug</span>
                  <span className="font-mono text-xs">{tenant.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span>{tenant.plan}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDate(tenant.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Active</span>
                  <span>{formatRelativeTime(tenant.lastActive)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Usage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ProgressBar label="Leagues" current={tenant.usage.leagues.current} limit={tenant.usage.leagues.limit} />
                <ProgressBar label="Contests" current={tenant.usage.contests.current} limit={tenant.usage.contests.limit} />
                <ProgressBar label="Members" current={tenant.usage.members.current} limit={tenant.usage.members.limit} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Signups</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {tenant.recentSignups.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{s.email}</span>
                    <span className="text-muted-foreground">{formatDate(s.date)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Members */}
        <TabsContent value="members">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Email</th>
                    <th className="px-4 py-3 text-left font-medium">Display Name</th>
                    <th className="px-4 py-3 text-left font-medium">Role</th>
                    <th className="px-4 py-3 text-left font-medium">Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.membersList.map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="px-4 py-3">{m.email}</td>
                      <td className="px-4 py-3 font-medium">{m.displayName}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{m.role}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(m.lastActive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Leagues */}
        <TabsContent value="leagues">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Name</th>
                    <th className="px-4 py-3 text-left font-medium">Sport</th>
                    <th className="px-4 py-3 text-left font-medium">Members</th>
                    <th className="px-4 py-3 text-left font-medium">Contests</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.leaguesList.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{l.name}</td>
                      <td className="px-4 py-3">{l.sport}</td>
                      <td className="px-4 py-3">{l.members}</td>
                      <td className="px-4 py-3">{l.contests}</td>
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
                    <th className="px-4 py-3 text-left font-medium">Type</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.contestsList.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3">{c.sport}</td>
                      <td className="px-4 py-3">{c.type}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn(
                          c.status === 'Active' && 'bg-green-100 text-green-800 border-green-200',
                          c.status === 'Upcoming' && 'bg-blue-100 text-blue-800 border-blue-200',
                          c.status === 'Completed' && 'bg-gray-100 text-gray-800 border-gray-200',
                        )}>{c.status}</Badge>
                      </td>
                      <td className="px-4 py-3">{c.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {tenant.activity.map((a) => (
                  <div key={a.id} className="flex items-start justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{a.action}</p>
                      <p className="text-sm text-muted-foreground">{a.description}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(a.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
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
