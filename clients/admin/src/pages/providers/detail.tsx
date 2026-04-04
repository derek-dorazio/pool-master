import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Activity,
  HeartPulse,
  Settings,
  Database,
  Link2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  client,
  adminTriggerHealthCheck,
  adminMapParticipant,
} from '@/lib/api';
import { useProviderDetail } from '@/hooks/use-providers-api';
import type { ProviderStatus } from '@/hooks/use-providers-api';

function statusBadge(status: ProviderStatus) {
  switch (status) {
    case 'HEALTHY':
      return <Badge className="bg-green-100 text-green-800 text-sm gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-500" />HEALTHY</Badge>;
    case 'DEGRADED':
      return <Badge className="bg-yellow-100 text-yellow-800 text-sm gap-1"><span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />DEGRADED</Badge>;
    case 'DOWN':
      return <Badge className="bg-red-100 text-red-800 text-sm gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />DOWN</Badge>;
  }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Unavailable';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Component() {
  const { providerId } = useParams<{ providerId: string }>();
  const queryClient = useQueryClient();
  const { data: provider, isLoading, isError, error } = useProviderDetail(providerId ?? '');
  const dialog = useConfirmDialog();

  if (isLoading || !provider) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading provider...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-red-600">
          Provider detail is unavailable.
          <span className="ml-2 text-muted-foreground">
            {error instanceof Error ? error.message : 'Check the provider adapters and persisted health logs.'}
          </span>
        </p>
      </div>
    );
  }

  async function runHealthCheck() {
    const confirmed = await dialog.confirm(
      'Run Health Check',
      'Run a live health check now?',
    );
    if (!confirmed || !providerId) return;

    await adminTriggerHealthCheck({ client, path: { providerId } });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'provider', providerId] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] });
  }

  async function mapParticipant(externalId: string, providerName: string) {
    const confirmed = await dialog.confirm(
      'Map Participant',
      `Map "${providerName}" to an internal participant ID?`,
      { confirmLabel: 'Continue' },
    );
    if (!confirmed || !providerId) return;

    const internalId = window.prompt(`Enter the internal participant UUID for ${providerName}`);
    if (!internalId) return;

    await adminMapParticipant({
      client,
      body: { providerId, externalId, internalId },
    });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'provider', providerId] });
  }

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/providers" className="hover:text-foreground">Providers</Link>
        <span>/</span>
        <span className="text-foreground">{provider.providerName}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Activity className="h-7 w-7" />
          <div>
            <h1 className="text-2xl font-bold">{provider.providerName}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              <span>Provider ID: <span className="font-mono font-medium text-foreground">{provider.providerId}</span></span>
              <span>Error Rate: <span className={cn('font-mono font-medium', provider.errorRate > 5 ? 'text-red-600' : 'text-foreground')}>{provider.errorRate.toFixed(1)}%</span></span>
              <span>Avg Latency: <span className={cn('font-mono font-medium', provider.latencyMs > 1000 ? 'text-red-600' : 'text-foreground')}>{provider.latencyMs}ms</span></span>
            </div>
          </div>
        </div>
        {statusBadge(provider.status)}
      </div>

      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health"><HeartPulse className="mr-1 h-4 w-4" />Health</TabsTrigger>
          <TabsTrigger value="metadata"><Settings className="mr-1 h-4 w-4" />Live Metadata</TabsTrigger>
          <TabsTrigger value="ingestion"><Database className="mr-1 h-4 w-4" />Ingestion</TabsTrigger>
          <TabsTrigger value="mapping"><Link2 className="mr-1 h-4 w-4" />Mapping</TabsTrigger>
        </TabsList>

        <TabsContent value="health">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Live Health Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span>{provider.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Checked</span>
                    <span>{provider.recentHealthChecks[0] ? formatDateTime(provider.recentHealthChecks[0].checkedAt) : 'Not checked yet'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recent health logs</span>
                    <span>{provider.recentHealthChecks.length}</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={runHealthCheck}>
                    <HeartPulse className="mr-2 h-4 w-4" />
                    Run Health Check
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent Live Signals</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last event</span>
                    <span>{formatDateTime(provider.lastEventAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active events</span>
                    <span>{provider.activeEventCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mapped participants</span>
                    <span>{provider.mappedParticipantCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unmapped participants</span>
                    <span>{provider.unmappedParticipants.length}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Health Logs</CardTitle>
                <CardDescription>{provider.recentHealthChecks.length} persisted checks</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Checked</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Error Rate</th>
                      <th className="px-4 py-3 text-right font-medium">Latency</th>
                      <th className="px-4 py-3 text-left font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.recentHealthChecks.map((check) => (
                      <tr key={`${check.providerId}-${check.checkedAt}`} className="border-b">
                        <td className="px-4 py-3 text-muted-foreground">{formatDateTime(check.checkedAt)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{check.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{check.errorRate.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right font-mono">{check.latencyMs}</td>
                        <td className="px-4 py-3 text-muted-foreground">{check.details}</td>
                      </tr>
                    ))}
                    {provider.recentHealthChecks.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                          No persisted health checks yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="metadata">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live Provider Metadata</CardTitle>
              <CardDescription>Derived from the adapter registry and persisted health data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider name</span>
                <span>{provider.providerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sports covered</span>
                <span>{provider.sportsCovered.join(', ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Live active events</span>
                <span>{provider.activeEventCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Persisted mappings</span>
                <span>{provider.mappedParticipantCount}</span>
              </div>
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Editable provider configuration is not persisted yet. This panel shows the live adapter identity and the latest database-backed health state instead of fake credentials or thresholds.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ingestion">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Per-Sport Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Sport</th>
                      <th className="px-4 py-3 text-left font-medium">Last Poll</th>
                      <th className="px-4 py-3 text-left font-medium">Last Event</th>
                      <th className="px-4 py-3 text-right font-medium">Events Today</th>
                      <th className="px-4 py-3 text-right font-medium">Errors Today</th>
                      <th className="px-4 py-3 text-right font-medium">Active Events</th>
                      <th className="px-4 py-3 text-right font-medium">Dependent Contests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.ingestionStats.map((s) => (
                      <tr key={`${s.providerId}:${s.sport}`} className="border-b">
                        <td className="px-4 py-3 font-medium">{s.sport}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDateTime(s.lastPollAt)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDateTime(s.lastEventReceivedAt)}</td>
                        <td className="px-4 py-3 text-right font-mono">{s.eventsToday}</td>
                        <td className={cn('px-4 py-3 text-right font-mono', s.errorsToday > 0 ? 'text-red-600' : '')}>
                          {s.errorsToday}
                        </td>
                        <td className="px-4 py-3 text-right">{s.activeEventCount}</td>
                        <td className="px-4 py-3 text-right">{s.contestsDepending}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Ingestion Jobs</CardTitle>
                <CardDescription>{provider.recentJobs.length} jobs on record</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Job</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Processed</th>
                      <th className="px-4 py-3 text-right font-medium">Errors</th>
                      <th className="px-4 py-3 text-left font-medium">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.recentJobs.map((job) => (
                      <tr key={job.id} className="border-b">
                        <td className="px-4 py-3">
                          <div className="font-medium">{job.eventId ?? job.id}</div>
                          <div className="text-xs text-muted-foreground">{job.providerId} / {job.sport}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{job.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{job.recordsProcessed}</td>
                        <td className={cn('px-4 py-3 text-right font-mono', job.errors > 0 ? 'text-red-600' : '')}>{job.errors}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDateTime(job.startedAt)}</td>
                      </tr>
                    ))}
                    {provider.recentJobs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                          No ingestion jobs have been recorded for this provider yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Provider Errors</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                      <th className="px-4 py-3 text-left font-medium">Type</th>
                      <th className="px-4 py-3 text-left font-medium">Message</th>
                      <th className="px-4 py-3 text-left font-medium">Event ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.recentErrors.map((err, i) => (
                      <tr key={`${err.providerId}-${i}-${err.occurredAt}`} className="border-b">
                        <td className="px-4 py-3 text-muted-foreground">{formatDateTime(err.occurredAt)}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">{err.errorType}</Badge>
                        </td>
                        <td className="px-4 py-3">{err.message}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{err.eventId ?? 'N/A'}</td>
                      </tr>
                    ))}
                    {provider.recentErrors.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                          No errors recorded for this provider.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="mapping">
          <div className="space-y-4">
            {provider.unmappedParticipants.length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800">
                  {provider.unmappedParticipants.length} unmapped participants
                </span>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Participant Mapping</CardTitle>
                <CardDescription>Enter a real participant UUID when mapping an external record.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">External ID</th>
                      <th className="px-4 py-3 text-left font-medium">External Name</th>
                      <th className="px-4 py-3 text-left font-medium">Provider</th>
                      <th className="px-4 py-3 text-left font-medium">Sport</th>
                      <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.unmappedParticipants.map((u) => (
                      <tr key={`${u.providerId}:${u.externalId}`} className="border-b">
                        <td className="px-4 py-3 font-mono text-xs">{u.externalId}</td>
                        <td className="px-4 py-3">{u.externalName}</td>
                        <td className="px-4 py-3">{u.providerName}</td>
                        <td className="px-4 py-3">{u.sport}</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => mapParticipant(u.externalId, u.externalName)}
                          >
                            Map
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {provider.unmappedParticipants.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                          No unmapped participants remain for this provider.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
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
