import { applyEventParticipantUpload, previewEventParticipantUpload } from '@/lib/api';
import { BulkUploadPanel, Button, StatusBadge, Tile } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportEventParticipantDto } from '@/lib/api';
import {
  GOLF_FIELD_UPLOAD_HEADERS,
  formatGolfFieldUploadValues,
  golfFieldUploadBlockedCount,
  golfFieldUploadTemplateRows,
  parseGolfFieldUpload,
  type GolfFieldUploadPreviewRow,
  type GolfFieldUploadRow,
} from './golf-field-upload';

const RESOLUTION_TONE: Record<GolfFieldUploadPreviewRow['resolution'], 'active' | 'warning' | 'danger'> = {
  MATCHED: 'active',
  AMBIGUOUS: 'warning',
  UNRESOLVED: 'danger',
};

type Change = NonNullable<GolfFieldUploadPreviewRow['change']>;

const CHANGE_TONE: Record<Change, 'info' | 'neutral'> = {
  UPDATE: 'info',
  UNCHANGED: 'neutral',
};

function describeRow(row: GolfFieldUploadRow): string {
  return row.playerName ?? row.externalId ?? row.participantId ?? 'Unnamed row';
}

/**
 * #129 — bulk-adjust the Field editor's rankings, odds, seeds and withdrawals, built on the
 * shared {@link BulkUploadPanel}. The upload changes golfers already on the field and never
 * adds one, so a golfer it cannot find has to come from the provider's field first.
 */
export function GolfFieldUploadCard({
  eventId,
  entries,
  onClose,
}: {
  eventId: string;
  entries: readonly SportEventParticipantDto[];
  onClose: () => void;
}) {
  const logger = getLogger().child({ feature: 'root-admin-golf-tournament-field-page' });

  const previewMutation = useInvalidatingMutation({
    mutationFn: async (rows: GolfFieldUploadRow[]) => {
      const response = await previewEventParticipantUpload({ path: { eventId }, body: { rows } });
      if (!response.data?.rows) {
        throwApiError(response.error, 'Field upload preview response is missing data.');
      }
      return response.data;
    },
    invalidates: [],
    onError: (error) => {
      logger.warn({ action: 'golf.fieldUpload.preview.failed', err: error }, 'Golf field upload preview was rejected');
    },
  });

  const applyMutation = useInvalidatingMutation({
    mutationFn: async (rows: GolfFieldUploadRow[]) => {
      const response = await applyEventParticipantUpload({ path: { eventId }, body: { rows } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Field upload response is missing data.');
      }
      return response.data.participants;
    },
    // The same reads the grid save refreshes: the field, and the tournament's counts and tiers.
    invalidates: [
      QueryKeys.rootAdmin.golf.field(eventId),
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
      QueryKeys.rootAdmin.golf.tiers(eventId),
    ],
    onError: (error) => {
      logger.warn({ action: 'golf.fieldUpload.apply.failed', err: error }, 'Golf field upload was rejected');
    },
  });

  const rollup = previewMutation.data?.rollup;

  return (
    <Tile data-testid="root-admin-golf-field-upload-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Bulk upload</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Adjust rankings, odds, seeds and withdrawals for golfers already on this field.
            Golfers must be on the field first — load it from the provider to add them.
          </p>
        </div>
        <Button data-testid="root-admin-golf-field-upload-close" onClick={onClose} size="sm" variant="secondary">
          Close
        </Button>
      </div>
      <div className="mt-4">
        <BulkUploadPanel<GolfFieldUploadRow, GolfFieldUploadPreviewRow>
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
          parse={parseGolfFieldUpload}
          preview={(rows) => previewMutation.mutateAsync(rows).then((response) => response.rows)}
          previewError={
            previewMutation.isError
              ? extractErrorMessage(previewMutation.error, { fallback: 'We could not preview this upload.' })
              : null
          }
          renderPreview={(rows) => (
            <div className="space-y-3">
              {rollup ? (
                <p className="text-sm text-muted-foreground" data-testid="root-admin-golf-field-upload-rollup">
                  {rollup.total} rows · {rollup.matched} matched · {rollup.unresolved} not on the field ·{' '}
                  {rollup.ambiguous} ambiguous · {rollup.duplicate} duplicate · {rollup.update} to update ·{' '}
                  {rollup.unchanged} unchanged
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="min-w-full text-left text-sm" data-testid="root-admin-golf-field-upload-preview-table">
                  <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Row</th>
                      <th className="px-4 py-2">Resolution</th>
                      <th className="px-4 py-2">Golfer</th>
                      <th className="px-4 py-2">Before → After</th>
                      <th className="px-4 py-2">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry, index) => (
                      <tr
                        className="border-t border-border"
                        data-testid={`root-admin-golf-field-upload-row-${index}`}
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
                          {formatGolfFieldUploadValues(entry.before)} →{' '}
                          <span className="text-foreground">{formatGolfFieldUploadValues(entry.after)}</span>
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
          templateFilename="golf-field-upload-template.csv"
          templateHeaders={GOLF_FIELD_UPLOAD_HEADERS}
          templateRows={entries.length > 0 ? golfFieldUploadTemplateRows(entries) : undefined}
          templateSampleRow={['ext-123', 'Rory McIlroy', 2, 8.5, 2, 'true', '']}
          testId="root-admin-golf-field-upload"
          unresolvedCount={golfFieldUploadBlockedCount}
          unresolvedNotice={(count) =>
            `${count} row${count === 1 ? '' : 's'} cannot be applied: each row must name one golfer already on this field, once. Fix or remove ${
              count === 1 ? 'it' : 'them'
            } before applying.`
          }
        />
      </div>
    </Tile>
  );
}
