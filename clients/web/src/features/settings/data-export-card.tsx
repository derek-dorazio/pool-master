import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDataExportStatus, useRequestDataExport } from './hooks/use-data-export';

export function DataExportCard() {
  const { data: exportStatus } = useDataExportStatus();
  const requestExport = useRequestDataExport();

  const isPending = exportStatus?.status === 'pending';
  const isReady = exportStatus?.status === 'ready';
  const isRateLimited = exportStatus?.nextAllowedAt
    ? new Date(exportStatus.nextAllowedAt) > new Date()
    : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Export</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Request a copy of all your Ultimate Pool Manager data. We'll prepare the export and email you a
          download link within 48 hours.
        </p>

        {isPending && exportStatus.requestedAt && (
          <p className="text-sm text-muted-foreground">
            Export in progress — requested on{' '}
            {new Date(exportStatus.requestedAt).toLocaleDateString()}
          </p>
        )}

        {isReady && exportStatus.downloadUrl && (
          <p className="text-sm">
            Your last export is ready —{' '}
            <a
              href={exportStatus.downloadUrl}
              className="text-primary underline"
            >
              download
            </a>
            {exportStatus.expiresAt && (
              <span className="text-muted-foreground">
                {' '}(expires {new Date(exportStatus.expiresAt).toLocaleDateString()})
              </span>
            )}
          </p>
        )}

        {isRateLimited && exportStatus?.nextAllowedAt && (
          <p className="text-xs text-muted-foreground">
            You can request another export on{' '}
            {new Date(exportStatus.nextAllowedAt).toLocaleDateString()}
          </p>
        )}

        <Button
          onClick={() => requestExport.mutate()}
          disabled={isPending || isRateLimited || requestExport.isPending}
        >
          {isPending ? 'Export Requested' : requestExport.isPending ? 'Requesting...' : 'Request My Data'}
        </Button>
      </CardContent>
    </Card>
  );
}
