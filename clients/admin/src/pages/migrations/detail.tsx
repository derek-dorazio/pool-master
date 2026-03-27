import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useMigrationDetail } from '@/hooks/use-migrations-api';

function statusClass(status: string): string {
  switch (status) {
    case 'Completed':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'Failed':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'Running':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    default:
      return '';
  }
}

export function Component() {
  const { id } = useParams<{ id: string }>();
  const { data: run, isLoading } = useMigrationDetail(id ?? 'run-001');

  if (isLoading || !run) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Migration Detail</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isRunning = run.status === 'Running';

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
          <Badge className={cn('text-xs', statusClass(run.status))}>{run.status}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>Started by <span className="font-medium text-foreground">{run.startedBy}</span></span>
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
              {run.processedRecords.toLocaleString()} of {run.totalRecords.toLocaleString()} records processed
            </span>
          </div>
          <div className="h-4 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                run.status === 'Failed' ? 'bg-red-500' : 'bg-primary',
              )}
              style={{ width: `${run.progress}%` }}
            />
          </div>
          <div className="text-right text-lg font-bold">{run.progress}%</div>
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
            <div className="text-2xl font-bold">{run.succeededRecords.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-medium">Failed</span>
            </div>
            <div className="text-2xl font-bold text-red-600">{run.failedRecords}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">Duration</span>
            </div>
            <div className="text-2xl font-bold">{run.duration}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">Est. Completion</span>
            </div>
            <div className="text-2xl font-bold">
              {run.estimatedRemaining ?? '--'}
            </div>
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
      {isRunning && (
        <div className="flex justify-end">
          <Button variant="destructive" onClick={() => window.alert('Migration cancelled.')}>
            Cancel Migration
          </Button>
        </div>
      )}
    </div>
  );
}
