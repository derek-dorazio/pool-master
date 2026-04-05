import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Users,
  Trophy,
  Radio,
  Bell,
  TrendingUp,
  TrendingDown,
  Search,
  Flag,
  Database,
  AlertTriangle,
  Info,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAdminMetrics } from '@/hooks/use-admin-api';

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const metricConfig = [
  { key: 'activeTenants' as const, label: 'Active Tenants', icon: Building2, suffix: '' },
  { key: 'totalUsers' as const, label: 'Total Users', icon: Users, suffix: '' },
  { key: 'activeContests' as const, label: 'Active Contests', icon: Trophy, suffix: '' },
  { key: 'liveDrafts' as const, label: 'Live Drafts', icon: Radio, suffix: '' },
  { key: 'notificationRate' as const, label: 'Notification Rate', icon: Bell, suffix: '%' },
];

const severityConfig = {
  Info: { icon: Info, className: 'bg-blue-100 text-blue-800 border-blue-200' },
  Warning: { icon: AlertTriangle, className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  Critical: { icon: AlertCircle, className: 'bg-red-100 text-red-800 border-red-200' },
};

export function Component() {
  const navigate = useNavigate();
  const { data, isLoading } = useAdminMetrics();

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  const { metrics, services, alerts, audit } = data;

  return (
    <div className="space-y-6" data-testid="admin-home-page">
      <h1 className="text-2xl font-bold">Platform Overview</h1>

      {/* Metrics row */}
      <div className="grid grid-cols-5 gap-4">
        {metricConfig.map(({ key, label, icon: Icon, suffix }) => {
          const m = metrics[key];
          const isUp = m.trend >= 0;
          return (
            <Card key={key}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span
                    className={cn(
                      'flex items-center gap-1 text-xs font-medium',
                      isUp ? 'text-green-600' : 'text-red-600',
                    )}
                  >
                    {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {isUp ? '+' : ''}{m.trend}%
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold">
                  {m.value.toLocaleString()}{suffix}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Service Health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Service Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            {services.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-block h-2.5 w-2.5 rounded-full',
                    s.status === 'green' && 'bg-green-500',
                    s.status === 'yellow' && 'bg-yellow-500',
                    s.status === 'red' && 'bg-red-500',
                  )}
                />
                <span className="text-sm">{s.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert) => {
              const cfg = severityConfig[alert.severity];
              return (
                <div key={alert.id} className="flex items-start gap-3">
                  <Badge className={cn('shrink-0', cfg.className)} variant="outline">
                    {alert.severity}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{alert.message}</p>
                    <p className="text-xs text-muted-foreground">{formatRelativeTime(alert.timestamp)}</p>
                  </div>
                </div>
              );
            })}
            {alerts.length === 0 && (
              <p className="text-sm text-muted-foreground">No active alerts.</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Audit */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Audit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {audit.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{entry.adminName}</span>{' '}
                      <span className="text-muted-foreground">{entry.action}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{entry.description}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                </div>
              ))}
              {audit.length === 0 && (
                <p className="text-sm text-muted-foreground">No recent audit activity.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => navigate('/users')}>
              <Search className="mr-2 h-4 w-4" />
              Search User
            </Button>
            <Button variant="outline" onClick={() => navigate('/tenants')}>
              <Building2 className="mr-2 h-4 w-4" />
              Search Tenant
            </Button>
            <Button variant="outline" onClick={() => navigate('/providers')}>
              <Database className="mr-2 h-4 w-4" />
              View Providers
            </Button>
            <Button variant="outline" onClick={() => navigate('/flags')}>
              <Flag className="mr-2 h-4 w-4" />
              View Flags
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
