import { useState, useEffect } from 'react';
import {
  Activity,
  Database,
  HardDrive,
  MessageSquare,
  Cloud,
  Users,
  Zap,
  Bell,
  Trophy,
  Gamepad2,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useHealthDashboard } from '@/hooks/use-health-api';

function formatSecondsAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  return `Last refreshed ${seconds}s ago`;
}

export function Component() {
  const { data, isLoading } = useHealthDashboard();
  const [refreshLabel, setRefreshLabel] = useState('');

  useEffect(() => {
    if (!data) return;
    setRefreshLabel(formatSecondsAgo(data.lastRefreshed));
    const interval = setInterval(() => {
      setRefreshLabel(formatSecondsAgo(data.lastRefreshed));
    }, 1000);
    return () => clearInterval(interval);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Health Dashboard</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const infraIcons: Record<string, React.ReactNode> = {
    PostgreSQL: <Database className="h-4 w-4" />,
    Redis: <HardDrive className="h-4 w-4" />,
    'Message Bus': <MessageSquare className="h-4 w-4" />,
    'S3/CDN': <Cloud className="h-4 w-4" />,
  };

  const metricIcons = [
    <Users className="h-5 w-5" key="users" />,
    <Zap className="h-5 w-5" key="api" />,
    <Bell className="h-5 w-5" key="notif" />,
    <Trophy className="h-5 w-5" key="contest" />,
    <Gamepad2 className="h-5 w-5" key="draft" />,
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Health Dashboard</h1>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          {refreshLabel}
        </span>
      </div>

      {/* Services */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5" />
            Services
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Service</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Uptime</th>
                  <th className="pb-2 pr-4 font-medium">Error Rate</th>
                  <th className="pb-2 pr-4 font-medium">P95 Latency</th>
                  <th className="pb-2 font-medium">Version</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((svc) => (
                  <tr key={svc.name} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{svc.name}</td>
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-block h-2.5 w-2.5 rounded-full',
                            svc.status === 'UP' && 'bg-green-500',
                            svc.status === 'DEGRADED' && 'bg-yellow-500',
                            svc.status === 'DOWN' && 'bg-red-500',
                          )}
                        />
                        {svc.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">{svc.uptime}</td>
                    <td className="py-2.5 pr-4">{svc.errorRate}</td>
                    <td className="py-2.5 pr-4">{svc.p95Latency}</td>
                    <td className="py-2.5 font-mono text-xs">{svc.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Infrastructure */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Infrastructure</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.infrastructure.map((infra) => (
            <Card key={infra.name}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-3">
                  {infraIcons[infra.name]}
                  <span className="font-medium">{infra.name}</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{infra.metric1Label}</span>
                    <span className="font-medium">{infra.metric1Value}</span>
                  </div>
                  {infra.metric2Label && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{infra.metric2Label}</span>
                      <span className="font-medium">{infra.metric2Value}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Key Metrics</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {data.keyMetrics.map((metric, idx) => (
            <Card key={metric.label}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                  {metricIcons[idx]}
                  <span className="text-xs font-medium">{metric.label}</span>
                </div>
                <div className="text-2xl font-bold">{metric.value}</div>
                {metric.detail && (
                  <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
