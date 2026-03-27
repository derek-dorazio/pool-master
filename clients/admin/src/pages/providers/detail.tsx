import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Activity, HeartPulse, Settings, Database, Link2,
  AlertTriangle, CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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

export function Component() {
  const { providerId } = useParams<{ providerId: string }>();
  const { data: provider } = useProviderDetail(providerId ?? '');

  if (!provider) return null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/providers" className="hover:text-foreground">Providers</Link>
        <span>/</span>
        <span className="text-foreground">{provider.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Activity className="h-7 w-7" />
          <div>
            <h1 className="text-2xl font-bold">{provider.name}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
              <span>Error Rate: <span className={cn('font-mono font-medium', provider.errorRate > 5 ? 'text-red-600' : 'text-foreground')}>{provider.errorRate}%</span></span>
              <span>Avg Latency: <span className={cn('font-mono font-medium', provider.avgLatency > 1000 ? 'text-red-600' : 'text-foreground')}>{provider.avgLatency}ms</span></span>
            </div>
          </div>
        </div>
        {statusBadge(provider.status)}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health"><HeartPulse className="mr-1 h-4 w-4" />Health</TabsTrigger>
          <TabsTrigger value="configuration"><Settings className="mr-1 h-4 w-4" />Configuration</TabsTrigger>
          <TabsTrigger value="ingestion"><Database className="mr-1 h-4 w-4" />Ingestion</TabsTrigger>
          <TabsTrigger value="mapping"><Link2 className="mr-1 h-4 w-4" />Mapping</TabsTrigger>
        </TabsList>

        {/* Health */}
        <TabsContent value="health">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Error Rate (24h)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                    Chart: error rate trending down
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Latency (24h)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                    Chart: latency stable at ~{provider.avgLatency}ms
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Recent Errors</CardTitle>
                  <CardDescription>{provider.recentErrors.length} errors in last 24h</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => window.confirm('Run health check now?')}>
                  <HeartPulse className="mr-2 h-4 w-4" />
                  Run Health Check
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                      <th className="px-4 py-3 text-left font-medium">Error Type</th>
                      <th className="px-4 py-3 text-left font-medium">Message</th>
                      <th className="px-4 py-3 text-left font-medium">Event ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.recentErrors.map((err, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {new Date(err.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">{err.errorType}</Badge>
                        </td>
                        <td className="px-4 py-3">{err.message}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{err.eventId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Configuration */}
        <TabsContent value="configuration">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">API Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">API Key</label>
                    <div className="flex gap-2">
                      <Input value={provider.apiKey} readOnly className="font-mono" />
                      <Button variant="outline" size="sm">Edit</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Webhook URL</label>
                    <Input value={provider.webhookUrl} readOnly className="font-mono text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Health Thresholds</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Degraded at</label>
                    <Input value={`${provider.thresholds.degraded}% error rate`} readOnly />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Down at</label>
                    <Input value={`${provider.thresholds.down}% error rate`} readOnly />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Max Latency</label>
                    <Input value={`${provider.thresholds.maxLatency}ms`} readOnly />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Budget</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Monthly Budget</label>
                    <Input value={`$${provider.budget.monthly}/month`} readOnly />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Spent</label>
                    <Input
                      value={`$${provider.budget.spent}`}
                      readOnly
                      className={cn(
                        provider.budget.spent / provider.budget.monthly > provider.budget.alertAt / 100
                          ? 'text-red-600'
                          : '',
                      )}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Alert At</label>
                    <Input value={`${provider.budget.alertAt}%`} readOnly />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Ingestion */}
        <TabsContent value="ingestion">
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
                    <th className="px-4 py-3 text-right font-medium">Events Today</th>
                    <th className="px-4 py-3 text-right font-medium">Errors Today</th>
                    <th className="px-4 py-3 text-right font-medium">Active Events</th>
                    <th className="px-4 py-3 text-right font-medium">Dependent Contests</th>
                  </tr>
                </thead>
                <tbody>
                  {provider.sports.map((s) => (
                    <tr key={s.sport} className="border-b">
                      <td className="px-4 py-3 font-medium">{s.sport}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.lastPoll}</td>
                      <td className="px-4 py-3 text-right font-mono">{s.eventsToday}</td>
                      <td className={cn('px-4 py-3 text-right font-mono', s.errorsToday > 0 ? 'text-red-600' : '')}>
                        {s.errorsToday}
                      </td>
                      <td className="px-4 py-3 text-right">{s.activeEvents}</td>
                      <td className="px-4 py-3 text-right">{s.dependentContests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mapping */}
        <TabsContent value="mapping">
          <div className="space-y-4">
            {provider.unmapped.filter((u) => u.status === 'Unmapped').length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800">
                  {provider.unmapped.filter((u) => u.status === 'Unmapped').length} unmapped participants
                </span>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Participant Mapping</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">External ID</th>
                      <th className="px-4 py-3 text-left font-medium">Provider Name</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.unmapped.map((u) => (
                      <tr key={u.externalId} className="border-b">
                        <td className="px-4 py-3 font-mono text-xs">{u.externalId}</td>
                        <td className="px-4 py-3">{u.providerName}</td>
                        <td className="px-4 py-3">
                          {u.status === 'Unmapped' ? (
                            <Badge className="bg-yellow-100 text-yellow-800 text-xs">Unmapped</Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-800 text-xs">
                              <CheckCircle className="mr-1 h-3 w-3" />Mapped
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.confirm(`Map "${u.providerName}" to an internal participant?`)}
                          >
                            Map
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
