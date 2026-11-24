import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProviderSyncRun } from '@/lib/api';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { ReadOnlyDetailModal } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { PRODUCT_NAME, ProviderSyncRunStatus } from '@poolmaster/shared/domain';
import {
  formatJsonPayload,
  getDetailsSection,
  type ProviderSyncRun,
  type ProviderSyncRunDetail,
} from './root-admin-sync-utils';
import { SyncRunDetail } from './sync-run-detail';
import { buildRunEvidenceRows, formatEventValue } from './sync-run-status';

/** A sync run opened from Recent runs: its facts, then what it did, changed and captured. */
export function SyncRunDialog({
  onClose,
  run,
}: {
  onClose: () => void;
  run: ProviderSyncRun;
}) {
  // The list carries each run's summary only; its detailed diagnostics load when it is opened (#1174).
  const runDetailQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providerSyncRun(run.id),
    queryFn: async (): Promise<ProviderSyncRunDetail> => {
      const response = await getProviderSyncRun({ path: { syncRunId: run.id } });
      if (!response.data) {
        throwApiError(response.error, 'Provider sync run response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });
  const runDetails = runDetailQuery.data?.details;

  const evidenceRows = useMemo(() => buildRunEvidenceRows(runDetails), [runDetails]);
  const providerPayload = getDetailsSection(runDetails, 'providerPayload');
  const jobPayload = getDetailsSection(runDetails, 'jobPayload');
  const evidenceEmptyMessage = runDetails === null
    ? run.status === ProviderSyncRunStatus.SUBMITTED
      ? 'This run hasn\'t started yet, so it has no details.'
      : 'Detailed diagnostics are kept for 30 days. None are stored for this run.'
    : [
        `No ${PRODUCT_NAME} rows changed in this sync.`,
        providerPayload?.rawCaptured === true ? 'Open the provider payload below to see what the provider sent.' : null,
      ].filter(Boolean).join(' ');

  return (
    <ReadOnlyDetailModal
      copyText={formatJsonPayload({ run, details: runDetails ?? null })}
      description="What the run did, what it changed, and the payloads it captured."
      detailContent={(
        <SyncRunDetail
          detailQuery={runDetailQuery}
          evidenceEmptyMessage={evidenceEmptyMessage}
          evidenceRows={evidenceRows}
          payloads={[
            { key: 'job', label: 'Job payload', payload: jobPayload },
            { key: 'provider', label: 'Provider payload', payload: providerPayload },
          ]}
          run={run}
        />
      )}
      details={[
        { id: 'status', label: 'Status', value: enumLabel('ProviderSyncRunStatus', run.status) },
        { id: 'kind', label: 'Sync', value: enumLabel('ProviderSyncKind', run.kind) },
        { id: 'trigger', label: 'Trigger', value: enumLabel('JobTrigger', run.trigger) },
        { id: 'errors', label: 'Errors', value: String(run.errorCount) },
        { id: 'sport', label: 'Sport', value: run.sport },
        { id: 'event', label: 'Event', value: formatEventValue(run.eventId) },
        { id: 'provider', label: 'Provider', value: run.providerName },
      ]}
      onCancel={onClose}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      testId="root-admin-sync-payload-modal"
      title="Sync run details"
    />
  );
}
