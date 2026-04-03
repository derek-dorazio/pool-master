import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProviderList } from '@/hooks/use-providers-api';
import type { ProviderStatus } from '@/hooks/use-providers-api';

function statusIndicator(status: ProviderStatus) {
  switch (status) {
    case 'HEALTHY':
      return { dot: 'text-green-500', label: 'HEALTHY', className: 'bg-green-100 text-green-800' };
    case 'DEGRADED':
      return { dot: 'text-yellow-500', label: 'DEGRADED', className: 'bg-yellow-100 text-yellow-800' };
    case 'DOWN':
      return { dot: 'text-red-500', label: 'DOWN', className: 'bg-red-100 text-red-800' };
  }
}

export function Component() {
  const navigate = useNavigate();
  const { data: providers = [], isError, error } = useProviderList();
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const healthyCount = providers.filter((p) => p.status === 'HEALTHY').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Sports Data Providers</h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Card className="px-4 py-3">
          <p className="text-sm font-medium">
            <span className={cn('font-bold', healthyCount === providers.length ? 'text-green-700' : 'text-yellow-700')}>
              {healthyCount} of {providers.length}
            </span>{' '}
            providers healthy
          </p>
        </Card>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" style={{ animationDuration: '30s' }} />
          Refreshing every 30s ({countdown}s)
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="px-4 py-8 text-sm text-red-600">
              Provider status is unavailable.
              <span className="ml-2 text-muted-foreground">
                {error instanceof Error ? error.message : 'Check the provider adapters or health logs.'}
              </span>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Provider Name</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Error Rate %</th>
                  <th className="px-4 py-3 text-right font-medium">Avg Latency (ms)</th>
                  <th className="px-4 py-3 text-left font-medium">Last Event</th>
                  <th className="px-4 py-3 text-right font-medium">Active Events</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  const si = statusIndicator(p.status);
                  return (
                    <tr
                      key={p.providerId}
                      className="border-b cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => navigate(`/providers/${p.providerId}`)}
                    >
                      <td className="px-4 py-3 font-medium">{p.providerName}</td>
                      <td className="px-4 py-3">
                        <Badge className={cn('text-xs gap-1', si.className)}>
                          <span className={cn('inline-block h-2 w-2 rounded-full', si.dot.replace('text-', 'bg-'))} />
                          {si.label}
                        </Badge>
                      </td>
                      <td className={cn(
                        'px-4 py-3 text-right font-mono',
                        p.errorRate > 5 ? 'text-red-600 font-medium' : '',
                      )}>
                        {p.errorRate.toFixed(1)}%
                      </td>
                      <td className={cn(
                        'px-4 py-3 text-right font-mono',
                        p.latencyMs > 1000 ? 'text-red-600 font-medium' : '',
                      )}>
                        {p.latencyMs.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.lastEventAt ? new Date(p.lastEventAt).toLocaleString() : 'No events yet'}
                      </td>
                      <td className="px-4 py-3 text-right">{p.activeEventCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
