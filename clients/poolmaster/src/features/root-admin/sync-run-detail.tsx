import {
  EmptyState,
  ExpandableRow,
  FactList,
  Heading,
  Notice,
  QueryState,
  StatusBadge,
  Text,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import {
  buildPayloadSummary,
  buildStatsSummary,
  formatJsonPayload,
  getPayloadWarnings,
  type ProviderSyncRun,
  type ProviderSyncRunDetail,
} from './root-admin-sync-utils';

/** One row a sync wrote (or left alone), with the JSON behind it. */
export type SyncRunEvidenceRow = {
  id: string;
  disposition: 'UNCHANGED' | 'CREATED' | 'UPDATED' | 'DELETED';
  entityType: string;
  identifier: string;
  name: string;
  providerId: string;
  eventId: string;
  participantId: string;
  detailsPayload: unknown;
};

/** A payload the run captured; `payload` is null when the run kept none of that kind. */
type CapturedPayload = { key: string; label: string; payload: unknown };

/** The run's details read, as `QueryState` takes it. */
type DetailQuery = {
  data: ProviderSyncRunDetail | undefined;
  error: Error | null;
  isError: boolean;
  refetch: () => unknown;
};

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="whitespace-pre-wrap break-words px-4 py-3">{formatJsonPayload(value)}</pre>;
}

/**
 * The body of a sync run's detail dialog: what the run did (summary, warnings, counts), each row
 * it changed with that row's JSON a click away, and each payload it captured. Every drill-down
 * opens in place, so no second dialog stacks on this one.
 */
export function SyncRunDetail({
  detailQuery,
  evidenceEmptyMessage,
  evidenceRows,
  payloads,
  run,
}: {
  detailQuery: DetailQuery;
  evidenceEmptyMessage: string;
  evidenceRows: readonly SyncRunEvidenceRow[];
  payloads: readonly CapturedPayload[];
  run: ProviderSyncRun;
}) {
  const warnings = getPayloadWarnings(run.payload);
  const stats = buildStatsSummary(run.payload);
  const captured = payloads.filter((entry) => entry.payload !== null && entry.payload !== undefined);

  return (
    <div className="space-y-5" data-testid="root-admin-sync-run-detail">
      <div className="space-y-2">
        <Text as="p" variant="strong">{buildPayloadSummary(run.payload)}</Text>
        {warnings.map((warning, index) => (
          <Notice key={`${warning.code}-${index}`} tone="warning">
            {warning.message}
          </Notice>
        ))}
      </div>

      {stats.length > 0 ? (
        <FactList
          facts={stats.map((stat) => ({ id: stat.key, label: stat.label, value: stat.value }))}
          testId="root-admin-sync-run-stats"
        />
      ) : (
        <EmptyState body="No sync stats were captured for this run." size="plain" />
      )}

      <section className="space-y-2">
        <Heading level={3} variant="label">Changes</Heading>
        <QueryState
          error={extractErrorMessage(detailQuery.error, { fallback: 'We could not load this run\'s details right now.' })}
          loading="Loading details..."
          query={detailQuery}
          testId="root-admin-sync-run-changes"
        >
          {() => (evidenceRows.length > 0 ? (
            <div className="divide-y divide-border rounded-lg border border-border" data-testid="root-admin-sync-detail-rows">
              {evidenceRows.map((row) => (
                <ExpandableRow
                  key={row.id}
                  label={`JSON for ${row.disposition} ${row.entityType} ${row.name}`}
                  summary={(
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={row.disposition === 'UNCHANGED' ? 'neutral' : 'warning'}>{row.disposition}</StatusBadge>
                      <Text variant="strong">{row.entityType}</Text>
                      <Text>{row.name}</Text>
                      <Text variant="meta">{row.identifier}</Text>
                    </span>
                  )}
                  testId={`root-admin-sync-detail-row-${row.id}`}
                >
                  <JsonBlock value={row.detailsPayload} />
                </ExpandableRow>
              ))}
            </div>
          ) : (
            <EmptyState body={evidenceEmptyMessage} size="plain" testId="root-admin-sync-detail-empty" />
          ))}
        </QueryState>
      </section>

      <section className="space-y-2">
        <Heading level={3} variant="label">Payloads</Heading>
        {captured.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border">
            {captured.map((entry) => (
              <ExpandableRow
                key={entry.key}
                label={entry.label}
                summary={<Text>{entry.label}</Text>}
                testId={`root-admin-sync-payload-${entry.key}`}
              >
                <JsonBlock value={entry.payload} />
              </ExpandableRow>
            ))}
          </div>
        ) : (
          <EmptyState body="No request, job, or provider payload was captured for this run." size="plain" />
        )}
      </section>
    </div>
  );
}
