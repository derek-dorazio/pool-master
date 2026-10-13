import { getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import { applyEventParticipantUpload, previewEventParticipantUpload } from '@/lib/api';
import { BulkUploadPanel, Button, StatusBadge, Tile } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportEventParticipantDto } from '@/lib/api';
import { capitalize, sportPathSegment } from './manage-navigation';
import {
  EVENT_FIELD_UPLOAD_HEADERS,
  formatEventFieldUploadValues,
  eventFieldUploadBlockedCount,
  eventFieldUploadTemplateRows,
  parseEventFieldUpload,
  type EventFieldUploadPreviewRow,
  type EventFieldUploadRow,
} from './event-field-upload';

const RESOLUTION_TONE: Record<EventFieldUploadPreviewRow['resolution'], 'active' | 'warning' | 'danger'> = {
  MATCHED: 'active',
  AMBIGUOUS: 'warning',
  UNRESOLVED: 'danger',
};

type Change = NonNullable<EventFieldUploadPreviewRow['change']>;

const CHANGE_TONE: Record<Change, 'info' | 'neutral'> = {
  UPDATE: 'info',
  UNCHANGED: 'neutral',
};

function describeRow(row: EventFieldUploadRow): string {
  return row.playerName ?? row.externalId ?? row.participantId ?? 'Unnamed row';
}

/**
 * #129 — bulk-adjust the Field editor's rankings, odds, seeds and withdrawals, built on the
 * shared {@link BulkUploadPanel}. The upload changes golfers already on the field and never
 * adds one, so a golfer it cannot find has to come from the provider's field first.
 */
export function EventFieldUploadCard({
  eventId,
  entries,
  onClose,
  sport,
}: {
  eventId: string;
  entries: readonly SportEventParticipantDto[];
  onClose: () => void;
  sport: Sport;
}) {
  const { participant } = getSportDefinition(sport).vocabulary;
  const logger = getLogger().child({ feature: 'root-admin-sport-event-field-page' });

  const previewMutation = useInvalidatingMutation({
    mutationFn: async (rows: EventFieldUploadRow[]) => {
      const response = await previewEventParticipantUpload({ path: { eventId }, body: { rows } });
      if (!response.data?.rows) {
        throwApiError(response.error, 'Field upload preview response is missing data.');
      }
      return response.data;
    },
    invalidates: [],
    onError: (error) => {
      logger.warn({ action: 'event.fieldUpload.preview.failed', err: error }, 'Field upload preview was rejected');
    },
  });

  const applyMutation = useInvalidatingMutation({
    mutationFn: async (rows: EventFieldUploadRow[]) => {
      const response = await applyEventParticipantUpload({ path: { eventId }, body: { rows } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Field upload response is missing data.');
      }
      return response.data.participants;
    },
    // The same reads the grid save refreshes: the field, and the tournament's counts and tiers.
    invalidates: [
      QueryKeys.rootAdmin.manageSport.field(eventId),
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
      QueryKeys.rootAdmin.manageSport.tiers(eventId),
    ],
    onError: (error) => {
      logger.warn({ action: 'event.fieldUpload.apply.failed', err: error }, 'Field upload was rejected');
    },
  });

  const rollup = previewMutation.data?.rollup;

  return (
    <Tile data-testid="root-admin-event-field-upload-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Bulk upload</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Adjust rankings, odds, seeds and withdrawals for {participant.many} already on this
            field. {capitalize(participant.many)} must be on the field first — add them to the field to adjust them.
          </p>
        </div>
        <Button data-testid="root-admin-event-field-upload-close" onClick={onClose} size="sm" variant="secondary">
          Close
        </Button>
      </div>
      <div className="mt-4">
        <BulkUploadPanel<EventFieldUploadRow, EventFieldUploadPreviewRow>
          apply={(rows) => applyMutation.mutateAsync(rows).then(() => undefined)}
          applyError={
            applyMutation.isError
              ? extractErrorMessage(applyMutation.error, { fallback: 'We could not apply this upload.' })
              : null
          }
          applyLabel="Apply to field"
          formatNote="Columns: externalId or playerName (one required), then any of ranking, oddsToWin, seedNumber, isActive (true / false), inactiveReason (WITHDRAWN / ELIMINATED). A blank cell leaves the value as it is; the word null clears it."
          isApplyPending={applyMutation.isPending}
          isPreviewPending={previewMutation.isPending}
          onApplied={() => previewMutation.reset()}
          parse={parseEventFieldUpload}
          preview={(rows) => previewMutation.mutateAsync(rows).then((response) => response.rows)}
          previewError={
            previewMutation.isError
              ? extractErrorMessage(previewMutation.error, { fallback: 'We could not preview this upload.' })
              : null
          }
          renderPreview={(rows) => (
            <div className="space-y-3">
              {rollup ? (
                <p className="text-sm text-muted-foreground" data-testid="root-admin-event-field-upload-rollup">
                  {rollup.total} rows · {rollup.matched} matched · {rollup.unresolved} not on the field ·{' '}
                  {rollup.ambiguous} ambiguous · {rollup.duplicate} duplicate · {rollup.update} to update ·{' '}
                  {rollup.unchanged} unchanged
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="min-w-full text-left text-sm" data-testid="root-admin-event-field-upload-preview-table">
                  <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Row</th>
                      <th className="px-4 py-2">Resolution</th>
                      <th className="px-4 py-2">{capitalize(participant.one)}</th>
                      <th className="px-4 py-2">Before → After</th>
                      <th className="px-4 py-2">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry, index) => (
                      <tr
                        className="border-t border-border"
                        data-testid={`root-admin-event-field-upload-row-${index}`}
                        key={`${describeRow(entry.row)}-${index}`}
                      >
                        <td className="px-4 py-2">{describeRow(entry.row)}</td>
                        <td className="px-4 py-2">
                          <StatusBadge tone={RESOLUTION_TONE[entry.resolution]}>{entry.resolution}</StatusBadge>
                        </td>
                        <td className="px-4 py-2">
                          {entry.participantName || '—'}
                          {entry.message ? (
                            <span className="mt-1 block text-xs text-muted-foreground">{entry.message}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {formatEventFieldUploadValues(entry.before)} →{' '}
                          <span className="text-foreground">{formatEventFieldUploadValues(entry.after)}</span>
                        </td>
                        <td className="px-4 py-2">
                          {entry.change ? (
                            <StatusBadge tone={CHANGE_TONE[entry.change]}>{entry.change}</StatusBadge>
                          ) : (
                            <StatusBadge tone="danger">{entry.rowError === 'DUPLICATE_PARTICIPANT' ? 'DUPLICATE' : 'BLOCKED'}</StatusBadge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          templateFilename={`${sportPathSegment(sport)}-field-upload-template.csv`}
          templateHeaders={EVENT_FIELD_UPLOAD_HEADERS}
          templateRows={entries.length > 0 ? eventFieldUploadTemplateRows(entries) : undefined}
          testId="root-admin-event-field-upload"
          unresolvedCount={eventFieldUploadBlockedCount}
          unresolvedNotice={(count) =>
            `${count} row${count === 1 ? '' : 's'} cannot be applied: each row must name one ${participant.one} already on this field, once. Fix or remove ${
              count === 1 ? 'it' : 'them'
            } before applying.`
          }
        />
      </div>
    </Tile>
  );
}
