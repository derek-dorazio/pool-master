import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Flag, Trash2, Plus, X, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  client,
  adminUpdateFlag,
  adminDeleteFlag,
  adminRemoveFlagOverride,
} from '@/lib/api';
import { useFlagDetail } from '@/hooks/use-flags-api';
import type { FlagType } from '@/hooks/use-flags-api';

function typeBadge(type: FlagType) {
  switch (type) {
    case 'Boolean':
      return <Badge variant="outline">Boolean</Badge>;
    case 'Percentage':
      return <Badge className="bg-purple-100 text-purple-800">Percentage</Badge>;
    case 'Tenant List':
      return <Badge className="bg-blue-100 text-blue-800">Tenant List</Badge>;
  }
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-green-500' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function Component() {
  const { flagKey } = useParams<{ flagKey: string }>();
  const { data: flag } = useFlagDetail(flagKey ?? '');
  const [enabled, setEnabled] = useState(flag?.enabled ?? false);
  const [rollout, setRollout] = useState(flag?.rolloutPct ?? 0);
  const [testTenant, setTestTenant] = useState('');
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const dialog = useConfirmDialog();

  if (!flag) return null;
  const flagOverrides = flag.overrides;

  function handleTest() {
    if (!testTenant.trim()) return;
    const override = flagOverrides.find(
      (o) => o.tenantName.toLowerCase().includes(testTenant.toLowerCase()),
    );
    if (override) {
      setTestResult(override.override);
    } else {
      setTestResult(enabled);
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/flags" className="hover:text-foreground">Feature Flags</Link>
        <span>/</span>
        <span className="text-foreground">{flag.key}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Flag className="h-7 w-7" />
          <div>
            <h1 className="text-2xl font-bold font-mono">{flag.key}</h1>
            <p className="text-muted-foreground">{flag.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {typeBadge(flag.type)}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Global:</span>
            <Toggle
              checked={enabled}
              onChange={async (v) => {
                setEnabled(v);
                await adminUpdateFlag({ client, path: { flagKey: flag.key }, body: { enabledGlobally: v } });
              }}
            />
          </div>
        </div>
      </div>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Description</dt>
              <dd className="text-sm">{flag.description}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Owner</dt>
              <dd className="text-sm font-medium">{flag.owner}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="text-sm">{flag.created}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last Updated</dt>
              <dd className="text-sm">{flag.lastUpdated}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Flag Type</dt>
              <dd className="mt-1">{typeBadge(flag.type)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Global Toggle:</span>
            <Toggle checked={enabled} onChange={setEnabled} />
            <span className={cn('text-sm font-medium', enabled ? 'text-green-700' : 'text-red-700')}>
              {enabled ? 'ON' : 'OFF'}
            </span>
          </div>

          {flag.type === 'Percentage' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Rollout Percentage</label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={rollout}
                  onChange={(e) => setRollout(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-14 text-right font-mono font-medium">{rollout}%</span>
              </div>
              <Button size="sm" onClick={async () => {
                await adminUpdateFlag({ client, path: { flagKey: flag.key }, body: { rolloutPercentage: rollout } });
              }}>
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tenant Overrides */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Tenant Overrides</CardTitle>
            <CardDescription>{flag.overrides.length} overrides configured</CardDescription>
          </div>
          <Button variant="outline" size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Add Override
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Tenant Name</th>
                <th className="px-4 py-3 text-left font-medium">Override</th>
                <th className="px-4 py-3 text-left font-medium">Reason</th>
                <th className="px-4 py-3 text-left font-medium">Set By</th>
                <th className="px-4 py-3 text-left font-medium">Set At</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
                                {flagOverrides.map((o) => (
                <tr key={o.tenantName} className="border-b">
                  <td className="px-4 py-3 font-medium">{o.tenantName}</td>
                  <td className="px-4 py-3">
                    <Badge className={cn(
                      'text-xs',
                      o.override ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
                    )}>
                      {o.override ? 'ON' : 'OFF'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{o.reason}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.setBy}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.setAt}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={async () => {
                        const confirmed = await dialog.confirm(
                          'Remove Override',
                          `Remove override for "${o.tenantName}"?`,
                          { confirmLabel: 'Remove', variant: 'destructive' },
                        );
                        if (confirmed) {
                          await adminRemoveFlagOverride({ client, path: { flagKey: flag.key, tenantId: o.tenantName } });
                        }
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Resolution Tester */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Resolution Tester
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter tenant ID or name..."
              value={testTenant}
              onChange={(e) => {
                setTestTenant(e.target.value);
                setTestResult(null);
              }}
            />
            <Button onClick={handleTest}>Test</Button>
          </div>
          {testResult !== null && (
            <div className={cn(
              'rounded-md px-4 py-3',
              testResult ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200',
            )}>
              <p className={cn('text-sm font-medium', testResult ? 'text-green-800' : 'text-red-800')}>
                For tenant &quot;{testTenant}&quot;, this flag resolves to:{' '}
                <span className="font-bold">{testResult ? 'ON' : 'OFF'}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete */}
      <div className="flex justify-end">
        <Button
          variant="destructive"
          onClick={async () => {
            const confirmed = await dialog.confirm(
              'Delete Flag',
              `Are you sure you want to delete flag "${flag.key}"? This cannot be undone.`,
              { confirmLabel: 'Delete', variant: 'destructive' },
            );
            if (confirmed) {
              await adminDeleteFlag({ client, path: { flagKey: flag.key } });
            }
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Flag
        </Button>
      </div>

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
