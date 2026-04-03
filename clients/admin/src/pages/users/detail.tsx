import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  client,
  adminResetPassword,
  adminForceLogout,
  adminDisableUser,
  adminSendEmail,
} from '@/lib/api';
import { useUserDetail } from '@/hooks/use-admin-api';

const statusColors: Record<string, string> = {
  Active: 'bg-green-100 text-green-800 border-green-200',
  Disabled: 'bg-red-100 text-red-800 border-red-200',
};

function formatDate(iso?: string): string {
  if (!iso) return 'Never';
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
    <button className="ml-1 inline-flex items-center rounded p-0.5 hover:bg-accent" onClick={handleCopy} title="Copy to clipboard">
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
      `Are you sure you want to ${action} for "${user?.displayName}"?`,
      { confirmLabel: action, variant: action === 'Disable Account' ? 'destructive' : 'default' },
    );
    if (confirmed && id) {
      switch (action) {
        case 'Reset Password':
          await adminResetPassword({ client, path: { userId: id } });
          break;
        case 'Force Logout':
          await adminForceLogout({ client, path: { userId: id } });
          break;
        case 'Disable Account':
          await adminDisableUser({ client, path: { userId: id }, body: { reason: 'Admin action' } });
          break;
        case 'Send Email':
          {
            const subject = window.prompt('Email subject:');
            if (!subject) return;
            const body = window.prompt('Email body:');
            if (!body) return;
            await adminSendEmail({ client, path: { userId: id }, body: { subject, body } });
          }
          break;
      }
    }
  }

  const statusLabel = user.status === 'disabled' ? 'Disabled' : 'Active';

  return (
    <div className="space-y-6">
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
            <Badge variant="outline" className={statusColors[statusLabel]}>{statusLabel}</Badge>
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

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tenants">Tenants & Leagues</TabsTrigger>
          <TabsTrigger value="contests">Contests</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="auth">Auth Events</TabsTrigger>
        </TabsList>

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
                <span>{user.authProvider ?? 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDate(user.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Login</span>
                <span>{formatDate(user.lastLoginAt)}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

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
                    <th className="px-4 py-3 text-left font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {user.tenants.map((membership) => (
                    <tr key={membership.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{membership.name}</td>
                      <td className="px-4 py-3"><Badge variant="outline">{membership.role}</Badge></td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(membership.joinedAt)}</td>
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
                    <th className="px-4 py-3 text-left font-medium">Tenant</th>
                  </tr>
                </thead>
                <tbody>
                  {user.leagues.map((league) => (
                    <tr key={league.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{league.name}</td>
                      <td className="px-4 py-3">{league.sport || 'Unknown'}</td>
                      <td className="px-4 py-3"><Badge variant="outline">{league.role}</Badge></td>
                      <td className="px-4 py-3 text-muted-foreground">{league.tenantName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

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
                  {user.activeContests.map((contest) => (
                    <tr key={contest.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{contest.name}</td>
                      <td className="px-4 py-3">{contest.sport}</td>
                      <td className="px-4 py-3">{contest.status}</td>
                      <td className="px-4 py-3">{contest.rank ? `#${contest.rank}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

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
                  {user.devices.map((device) => (
                    <tr key={device.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{device.platform}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(device.lastActiveAt)}</td>
                      <td className="px-4 py-3">{device.tokenStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

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
                  {user.recentAuthEvents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        No authentication events are available yet.
                      </td>
                    </tr>
                  ) : (
                    user.recentAuthEvents.map((event, index) => (
                      <tr key={`${event.type}-${event.timestamp}-${index}`} className="border-b">
                        <td className="px-4 py-3 font-medium capitalize">{event.type.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(event.timestamp)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{event.ipAddress ?? 'N/A'}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn(
                            event.success ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200',
                          )}>
                            {event.success ? 'Success' : 'Failed'}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
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
