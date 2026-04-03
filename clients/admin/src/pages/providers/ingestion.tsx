import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Zap, AlertCircle } from 'lucide-react';
import { useIngestionJobs } from '@/hooks/use-providers-api';

function statusTone(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'bg-blue-100 text-blue-800';
    case 'COMPLETED':
      return 'bg-green-100 text-green-800';
    case 'FAILED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-yellow-100 text-yellow-800';
  }
}

export function Component() {
  const { dashboard, isError, error } = useIngestionJobs();
  const jobs = dashboard?.activeJobs ?? [];
  const errors = dashboard?.recentErrors ?? [];
  const throughput = dashboard?.throughputPerMinute ?? 0;
  const recentCompletedJobs = dashboard?.recentCompletedJobs ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Ingestion Monitor</h1>
      </div>

      {/* Throughput stat */}
      <Card>
        <CardContent className="flex items-center gap-4 py-4">
          <Zap className="h-8 w-8 text-yellow-500" />
          <div>
            <p className="text-3xl font-bold font-mono">{throughput.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground">events/min</p>
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Ingestion dashboard is unavailable.
          <span className="ml-2 text-red-600/80">
            {error instanceof Error ? error.message : 'Check provider health logs and ingestion jobs.'}
          </span>
        </div>
      ) : null}

      {/* Active Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Jobs</CardTitle>
          <CardDescription>{jobs.length} jobs running</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {jobs.map((job) => (
            <div key={job.id} className="space-y-2 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{job.eventId ?? job.id}</p>
                  <p className="text-sm text-muted-foreground">
                    {job.providerId} / {job.sport}
                  </p>
                </div>
                <Badge variant="outline" className={statusTone(job.status)}>
                  {job.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Processed {job.recordsProcessed.toLocaleString()} records</span>
                <span>Errors {job.errors.toLocaleString()}</span>
              </div>
            </div>
          ))}
          {jobs.length === 0 && (
            <p className="text-sm text-muted-foreground">No active ingestion jobs.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently Completed</CardTitle>
          <CardDescription>{recentCompletedJobs.length} completed jobs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recentCompletedJobs.map((job) => (
            <div key={job.id} className="space-y-1 rounded-md border p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{job.eventId ?? job.id}</p>
                  <p className="text-muted-foreground">
                    {job.providerId} / {job.sport}
                  </p>
                </div>
                <Badge variant="outline">{job.status}</Badge>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Processed {job.recordsProcessed.toLocaleString()}</span>
                <span>{job.completedAt ? new Date(job.completedAt).toLocaleString() : 'Unavailable'}</span>
              </div>
            </div>
          ))}
          {recentCompletedJobs.length === 0 && (
            <p className="text-sm text-muted-foreground">No completed jobs yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Error Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            Recent Errors
          </CardTitle>
          <CardDescription>5 most recent ingestion errors</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Provider</th>
                <th className="px-4 py-3 text-left font-medium">Error Type</th>
                <th className="px-4 py-3 text-left font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((err, i) => (
                <tr key={i} className="border-b">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {new Date(err.occurredAt).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-3">{err.providerId}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">{err.errorType}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {err.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
