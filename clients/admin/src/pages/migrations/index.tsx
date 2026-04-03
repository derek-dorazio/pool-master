import { Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMigrations } from '@/hooks/use-migrations-api';

function statusClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'FAILED':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'RUNNING':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'QUEUED':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-700 border-gray-300';
    case 'Never Run':
      return 'bg-gray-100 text-gray-600 border-gray-200';
    default:
      return '';
  }
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return 'Never Run';
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));

  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function Component() {
  const { data, isLoading, isError } = useMigrations();

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Migrations</h1>
        <p className="text-destructive">Unable to load migration data.</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Migrations</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Migrations</h1>

      {/* Available Migrations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertCircle className="h-5 w-5" />
            Available Migrations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Description</th>
                  <th className="pb-2 pr-4 font-medium">Last Run</th>
                  <th className="pb-2 font-medium">Last Status</th>
                </tr>
              </thead>
              <tbody>
                {data.available.map((mig) => (
                  <tr key={mig.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs font-medium">{mig.name}</td>
                    <td className="py-2.5 pr-4">{mig.description}</td>
                    <td className="py-2.5 pr-4 text-xs">
                      {mig.lastRunAt
                        ? new Date(mig.lastRunAt).toLocaleString()
                        : '--'}
                    </td>
                    <td className="py-2.5">
                      <Badge className={cn('text-xs', statusClass(mig.lastRunStatus ?? 'Never Run'))}>
                        {formatStatus(mig.lastRunStatus)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Active Runs */}
      {data.activeRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 animate-spin" />
              Active Runs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.activeRuns.map((run) => (
              <div key={run.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-medium">{run.migrationName}</span>
                    <Badge className={cn('text-xs', statusClass(run.status))}>
                      {formatStatus(run.status)}
                    </Badge>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/migrations/${run.id}`}>View Details</Link>
                  </Button>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{run.progress.processed.toLocaleString()} / {run.progress.totalRecords.toLocaleString()} records</span>
                    <span>{run.progress.percentage}%</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${run.progress.percentage}%` }}
                    />
                  </div>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>{run.progress.failed} errors</span>
                  <span>{formatDuration(run.startedAt, run.completedAt)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recent History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle className="h-5 w-5" />
            Recent History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Migration</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Started</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 pr-4 font-medium">Records</th>
                  <th className="pb-2 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.recentHistory.map((run) => (
                  <tr key={run.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-4">
                      <Link
                        to={`/migrations/${run.id}`}
                        className="font-mono text-xs font-medium text-primary hover:underline"
                      >
                        {run.migrationName}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge className={cn('text-xs', statusClass(run.status))}>
                        {formatStatus(run.status)}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4">{formatDuration(run.startedAt, run.completedAt)}</td>
                    <td className="py-2.5 pr-4">{run.progress.processed.toLocaleString()}</td>
                    <td className="py-2.5">
                      <span className={cn(run.progress.failed > 0 && 'text-red-600 font-medium')}>
                        {run.progress.failed}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
