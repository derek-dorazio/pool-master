import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export function Component() {
  const { id } = useParams<{ id: string }>();
  const { data: tenant, isLoading, isError, error } = useTenantDetail(id);
  const [actionsOpen, setActionsOpen] = useState(false);
  const dialog = useConfirmDialog();

  if (isLoading || (!tenant && !isError)) {
    return (
      <div data-testid="tenant-detail-loading" className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading tenant...</p>
      </div>
    );
  }

  if (isError || !tenant) {
    return (
      <div data-testid="tenant-detail-error" className="flex items-center justify-center py-20">
        <p className="text-sm text-red-600">
          Tenant detail is unavailable.
          <span className="ml-2 text-muted-foreground">
            {error instanceof Error ? error.message : 'Check the tenant ID and try again.'}
          </span>
        </p>
      </div>
    );
  }

  async function handleAction(action: string) {
    setActionsOpen(false);
    const confirmed = await dialog.confirm(
      action,
      `Are you sure you want to ${action} for "${tenant?.name}"?`,
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
          {
            const amountInput = window.prompt('Credit amount to apply (e.g. 25.00):');
            if (!amountInput) return;
            const amount = Number(amountInput);
            if (!Number.isFinite(amount) || amount <= 0) return;
            const reason = window.prompt('Reason for credit:');
            if (!reason) return;
            await adminApplyCredit({ client, path: { tenantId: id }, body: { amount, reason } });
          }
          break;
        case 'Extend Trial':
          await adminExtendTrial({ client, path: { tenantId: id }, body: { days: 30, reason: 'Admin action' } });
          break;
        case 'Delete':
          await adminDeleteTenant({ client, path: { tenantId: id }, body: { confirmation: tenant?.name ?? '' } });
          break;
      }
    }
  }

  return (
    <div data-testid="tenant-detail-page" className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 data-testid="tenant-detail-name" className="text-2xl font-bold">{tenant.name}</h1>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={planColors[tenant.plan]}>{tenant.plan}</Badge>
            <Badge variant="outline" className={statusColors[tenant.statusLabel]}>{tenant.statusLabel}</Badge>
            <span className="text-sm text-muted-foreground">Created {formatDate(tenant.createdAt)}</span>
          </div>
        </div>
        <div className="relative">
          <Button data-testid="tenant-detail-actions" variant="outline" onClick={() => setActionsOpen(!actionsOpen)}>
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

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tenant Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Slug</span>
              <span className="font-mono text-xs">{tenant.slug}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Members</span>
              <span>{tenant.memberCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Leagues</span>
              <span>{tenant.leagueCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contests</span>
              <span>{tenant.contestCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active Contests</span>
              <span>{tenant.activeContestCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Active</span>
              <span>{formatRelativeTime(tenant.lastActive)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Settings Snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(tenant.tenant.settings, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Members</CardTitle>
        </CardHeader>
        <CardContent>
          {tenant.recentMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members found for this tenant.</p>
          ) : (
            <div className="space-y-2">
              {tenant.recentMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                  <div>
                    <p className="font-medium">{member.displayName}</p>
                    <p className="text-muted-foreground">{member.email}</p>
                  </div>
                  <span className="text-muted-foreground">{formatDate(member.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
