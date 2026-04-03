import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useCancelMigrationRun, useMigrationDetail } from '@/hooks/use-migrations-api';

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
    default:
      return '';
  }
}

function formatStatus(status: string): string {
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
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading, isError } = useMigrationDetail(runId ?? '');
  const cancelRun = useCancelMigrationRun();

  if (!runId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Migration Detail</h1>
        <p className="text-destructive">Missing migration run ID.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Migration Detail</h1>
        <p className="text-destructive">Unable to load this migration run.</p>
      </div>
    );
  }

  if (isLoading || !run) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Migration Detail</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isCancellable = run.status === 'QUEUED' || run.status === 'RUNNING';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/migrations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold font-mono">{run.migrationName}</h1>
          <Badge className={cn('text-xs', statusClass(run.status))}>{formatStatus(run.status)}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>Started by <span className="font-medium text-foreground">{run.startedBy.email}</span></span>
        <span>Started at <span className="font-medium text-foreground">{new Date(run.startedAt).toLocaleString()}</span></span>
        {run.completedAt && (
          <span>Completed at <span className="font-medium text-foreground">{new Date(run.completedAt).toLocaleString()}</span></span>
        )}
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Progress</span>
            <span className="text-muted-foreground">
              {run.progress.processed.toLocaleString()} of {run.progress.totalRecords.toLocaleString()} records processed
            </span>
          </div>
          <div className="h-4 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                run.status === 'FAILED' ? 'bg-red-500' : 'bg-primary',
              )}
              style={{ width: `${run.progress.percentage}%` }}
            />
          </div>
          <div className="text-right text-lg font-bold">{run.progress.percentage}%</div>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-xs font-medium">Succeeded</span>
            </div>
            <div className="text-2xl font-bold">{run.progress.succeeded.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-medium">Failed</span>
            </div>
            <div className="text-2xl font-bold text-red-600">{run.progress.failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">Duration</span>
            </div>
            <div className="text-2xl font-bold">{formatDuration(run.startedAt, run.completedAt)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">Est. Completion</span>
            </div>
            <div className="text-2xl font-bold">{run.status === 'QUEUED' ? 'Queued' : '--'}</div>
          </CardContent>
        </Card>
      </div>

      {/* Error log */}
      {run.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Error Log ({run.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Record ID</th>
                    <th className="pb-2 pr-4 font-medium">Error</th>
                    <th className="pb-2 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {run.errors.map((err, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 font-mono text-xs">{err.recordId}</td>
                      <td className="py-2.5 pr-4">{err.error}</td>
                      <td className="py-2.5 text-xs">
                        {new Date(err.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel button */}
      {isCancellable && (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={cancelRun.isPending}
            onClick={() => cancelRun.mutate(run.id)}
          >
            Cancel Migration
          </Button>
        </div>
      )}
    </div>
  );
}
