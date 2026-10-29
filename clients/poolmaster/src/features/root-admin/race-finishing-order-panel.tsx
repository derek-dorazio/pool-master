import { getSportDefinition, RaceResultOrderError, RaceResultStatus, type SportVocabulary } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { applyEventRaceResults, previewEventRaceResults } from '@/lib/api';
import type { SportEventDto, SportEventParticipantDto } from '@/lib/api';
import { Alert, BulkUploadPanel, Checkbox, PanelCard, StatusBadge } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  RACE_RESULT_STATUS_LABELS,
  RACE_RESULT_UPLOAD_HEADERS,
  describeRaceResult,
  formatOrdinal,
  parseRaceResultUpload,
  raceResultTemplateRows,
  type RaceResultPreviewRow,
  type RaceResultUploadRow,
} from './race-result-upload';
import { capitalize } from './manage-navigation';
import { useSportEventFieldQuery } from './use-sport-event';

const RESOLUTION_TONE: Record<RaceResultPreviewRow['resolution'], 'active' | 'warning' | 'danger'> = {
  MATCHED: 'active',
  AMBIGUOUS: 'warning',
  UNRESOLVED: 'danger',
};

const RESOLUTION_LABEL: Record<RaceResultPreviewRow['resolution'], string> = {
  MATCHED: 'Matched',
  AMBIGUOUS: 'Several matches',
  UNRESOLVED: 'Not in the field',
};

const CHANGE_LABEL: Record<NonNullable<RaceResultPreviewRow['change']>, string> = {
  CREATE: 'New',
  UPDATE: 'Changed',
  UNCHANGED: 'Unchanged',
};

const CHANGE_TONE: Record<NonNullable<RaceResultPreviewRow['change']>, 'success' | 'info' | 'neutral'> = {
  CREATE: 'success',
  UPDATE: 'info',
  UNCHANGED: 'neutral',
};

const ROW_ERROR_LABEL: Record<NonNullable<RaceResultPreviewRow['rowError']>, string> = {
  DUPLICATE_PARTICIPANT: 'Named on another row too',
  POSITION_WITHOUT_FINISH: 'A place, but it did not finish',
  FINISH_WITHOUT_POSITION: 'Finished, but has no place',
};

/** Why the finishing order as a whole cannot be applied, in the sport's words. */
function orderErrorMessages(vocabulary: SportVocabulary): Record<RaceResultOrderError, string> {
  return {
    [RaceResultOrderError.POSITIONS_INVALID]:
      'The places do not run 1, 2, 3 and on. Only a dead heat repeats a place, and the next place is then skipped (1, 2, 2, 4).',
    [RaceResultOrderError.FIELD_INCOMPLETE]:
      `An official result needs every ${vocabulary.participant.one} still in the field: a place for each finisher, or how its ${vocabulary.round.one} ended.`,
  };
}

/** What a refused apply's error code means, in the sport's words. */
function applyCodeMessages(vocabulary: SportVocabulary): ErrorCodeMessages {
  const orderErrors = orderErrorMessages(vocabulary);
  return {
    RACE_RESULT_POSITIONS_INVALID: orderErrors.POSITIONS_INVALID,
    RACE_RESULT_FIELD_INCOMPLETE: orderErrors.FIELD_INCOMPLETE,
    RACE_RESULT_ROWS_INVALID: `A row does not match one ${vocabulary.participant.one} in the field, or has a problem. Preview again to see which.`,
  };
}

function describeRow(row: RaceResultPreviewRow['row']): string {
  return row.playerName ?? row.externalId ?? row.participantId ?? 'Unnamed row';
}

/** A preview row that cannot be applied as it stands. */
function needsAttention(row: RaceResultPreviewRow): boolean {
  return row.resolution !== 'MATCHED' || row.rowError !== null;
}

/** The field in finishing order: placed runners first, then the rest by name. */
function byFinish(left: SportEventParticipantDto, right: SportEventParticipantDto): number {
  const leftPlace = left.race?.finishPosition ?? Number.POSITIVE_INFINITY;
  const rightPlace = right.race?.finishPosition ?? Number.POSITIVE_INFINITY;
  return leftPlace - rightPlace || left.participant.name.localeCompare(right.participant.name);
}

/** A race's stored result is official once any of its rows is: apply marks every row alike. */
function isStoredResultOfficial(field: readonly SportEventParticipantDto[]): boolean {
  return field.some((entry) => entry.race?.isOfficial === true);
}

/**
 * The finishing order as it is stored now, one row per runner: its place (or how its race ended),
 * where it started and who rode it. Contest scoring counts it once it is official.
 */
function StoredFinishingOrder({ event, field }: { event: SportEventDto; field: readonly SportEventParticipantDto[] }) {
  const { vocabulary } = getSportDefinition(event.sport);
  const official = isStoredResultOfficial(field);
  const hasResults = field.some((entry) => entry.race !== null);

  return (
    <PanelCard
      headingLevel={3}
      padded
      title="Result"
      trailing={hasResults ? (
        <StatusBadge data-testid="root-admin-race-result-official" tone={official ? 'final' : 'warning'}>
          {official ? 'Official' : 'Provisional'}
        </StatusBadge>
      ) : null}
    >
      {!hasResults ? (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="root-admin-race-result-empty">
          {`No results yet. Load the finishing order below once the ${vocabulary.round.one} is run.`}
        </p>
      ) : (
        <>
          {!official ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Contests count these places once the result is official.
            </p>
          ) : null}
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <table className="min-w-full text-left text-sm" data-testid="root-admin-race-result-table">
              <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Finish</th>
                  <th className="px-4 py-2">{capitalize(vocabulary.participant.one)}</th>
                  <th className="px-4 py-2">Start</th>
                  {vocabulary.rider !== undefined ? <th className="px-4 py-2">{vocabulary.rider}</th> : null}
                </tr>
              </thead>
              <tbody>
                {[...field].sort(byFinish).map((entry) => {
                  const { race } = entry;
                  const finish = !race
                    ? (entry.isActive ? '—' : vocabulary.withdrawn)
                    : race.resultStatus === RaceResultStatus.FINISHED
                      ? (race.finishPosition === null ? '—' : formatOrdinal(race.finishPosition))
                      : RACE_RESULT_STATUS_LABELS[race.resultStatus];
                  return (
                    <tr className="border-t border-border" data-testid={`root-admin-race-result-row-${entry.id}`} key={entry.id}>
                      <td className="px-4 py-2 font-medium" data-testid={`root-admin-race-result-finish-${entry.id}`}>{finish}</td>
                      <td className="px-4 py-2">{entry.participant.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{race?.startPosition ?? '—'}</td>
                      {vocabulary.rider !== undefined ? (
                        <td className="px-4 py-2 text-muted-foreground">{race?.riderName ?? '—'}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PanelCard>
  );
}

/**
 * Loads a race's finishing order (#623): paste or upload it, preview how each row resolves and
 * what it changes, then apply. Marking it official makes contests count it; the panel is
 * remounted when that changes, so a preview is never applied under the other setting.
 *
 * The official box follows the stored result until the admin changes it, because apply sets the
 * flag on every row of the race: a correction applied unticked would make an official race
 * provisional again.
 */
function FinishingOrderUploadCard({ event, field }: { event: SportEventDto; field: readonly SportEventParticipantDto[] }) {
  const logger = getLogger().child({ feature: 'root-admin-race-finishing-order' });
  const { vocabulary } = getSportDefinition(event.sport);
  const [chosenOfficial, setChosenOfficial] = useState<boolean | null>(null);
  const isOfficial = chosenOfficial ?? isStoredResultOfficial(field);

  const previewMutation = useInvalidatingMutation({
    mutationFn: async (rows: RaceResultUploadRow[]) => {
      const response = await previewEventRaceResults({ path: { eventId: event.id }, body: { isOfficial, rows } });
      if (!response.data?.rows) {
        throwApiError(response.error, 'Race result preview response is missing data.');
      }
      return response.data;
    },
    invalidates: [],
    onError: (error) => {
      logger.warn({ action: 'race.result.preview.failed', err: error }, 'Race result preview was rejected');
    },
  });

  const applyMutation = useInvalidatingMutation({
    mutationFn: async (rows: RaceResultUploadRow[]) => {
      const response = await applyEventRaceResults({ path: { eventId: event.id }, body: { isOfficial, rows } });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Race result apply response is missing data.');
      }
      return response.data.participants;
    },
    // The result is read back from the field; the event's counts follow it.
    invalidates: [QueryKeys.rootAdmin.manageSport.field(event.id), QueryKeys.rootAdmin.manageSport.event(event.id)],
    onError: (error) => {
      logger.warn({ action: 'race.result.apply.failed', err: error }, 'Race result apply was rejected');
    },
  });

  const orderErrors = previewMutation.data?.orderErrors ?? [];

  return (
    <PanelCard headingLevel={3} padded title="Finishing order">
      <p className="mt-1 text-sm text-muted-foreground">
        {`Paste or upload the ${vocabulary.round.one}'s result: a place for each ${vocabulary.participant.one} that finished, or DNF, DQ or DNS. Preview it, then apply. ${capitalize(vocabulary.participant.many)} you leave out keep the result they have.`}
      </p>
      <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={isOfficial}
          data-testid="root-admin-race-result-mark-official"
          onChange={(changeEvent) => {
            previewMutation.reset();
            applyMutation.reset();
            setChosenOfficial(changeEvent.target.checked);
          }}
        />
        This result is official. Contests score it, and every {vocabulary.participant.one} still in the field needs a result.
      </label>
      <div className="mt-4">
        <BulkUploadPanel<RaceResultUploadRow, RaceResultPreviewRow>
          apply={(rows) => applyMutation.mutateAsync(rows).then(() => undefined)}
          applyError={applyMutation.isError
            ? extractErrorMessage(applyMutation.error, {
              codeMessages: applyCodeMessages(vocabulary),
              fallback: 'We could not apply this result.',
            })
            : null}
          applyLabel={isOfficial ? 'Apply official result' : 'Apply result'}
          formatNote="Columns: externalId or playerName (one required), finishPosition, resultStatus (FINISHED, DNF, DQ or DNS; a place with no status is a finisher), startPosition and riderName (both optional). Rows with no place and no status are skipped."
          isApplyPending={applyMutation.isPending}
          isPreviewPending={previewMutation.isPending}
          key={`${event.id}:${String(isOfficial)}`}
          parse={parseRaceResultUpload}
          preview={(rows) => previewMutation.mutateAsync(rows).then((preview) => preview.rows)}
          previewError={previewMutation.isError
            ? extractErrorMessage(previewMutation.error, { fallback: 'We could not preview this result.' })
            : null}
          renderPreview={(rows) => (
            <div className="space-y-3">
              {orderErrors.map((orderError) => (
                <Alert data-testid={`root-admin-race-result-order-error-${orderError}`} key={orderError} tone="danger">
                  {orderErrorMessages(vocabulary)[orderError]}
                </Alert>
              ))}
              <div className="overflow-x-auto rounded-2xl border border-border">
                <table className="min-w-full text-left text-sm" data-testid="root-admin-race-result-upload-preview-table">
                  <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Row</th>
                      <th className="px-4 py-2">Match</th>
                      <th className="px-4 py-2">{capitalize(vocabulary.participant.one)}</th>
                      <th className="px-4 py-2">Before → After</th>
                      <th className="px-4 py-2">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry, index) => (
                      <tr className="border-t border-border" key={`${describeRow(entry.row)}-${index}`}>
                        <td className="px-4 py-2">{describeRow(entry.row)}</td>
                        <td className="px-4 py-2">
                          <StatusBadge tone={RESOLUTION_TONE[entry.resolution]}>{RESOLUTION_LABEL[entry.resolution]}</StatusBadge>
                        </td>
                        <td className="px-4 py-2">{entry.participantName ?? '—'}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {describeRaceResult(entry.before)}
                          {' → '}
                          <span className="text-foreground">{describeRaceResult(entry.after)}</span>
                        </td>
                        <td className="px-4 py-2">
                          {entry.rowError ? (
                            <StatusBadge tone="danger">{ROW_ERROR_LABEL[entry.rowError]}</StatusBadge>
                          ) : entry.change ? (
                            <StatusBadge tone={CHANGE_TONE[entry.change]}>{CHANGE_LABEL[entry.change]}</StatusBadge>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          templateFilename={`${event.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-finishing-order.csv`}
          templateHeaders={RACE_RESULT_UPLOAD_HEADERS}
          templateRows={field.length > 0 ? raceResultTemplateRows(field) : undefined}
          testId="root-admin-race-result-upload"
          unresolvedCount={(rows) => rows.filter(needsAttention).length + orderErrors.length}
          unresolvedNotice={() => 'Fix the rows and problems marked below, then preview again before applying.'}
        />
      </div>
    </PanelCard>
  );
}

/**
 * Finish position's results (#623): the race's stored result, and the card that loads or corrects
 * its finishing order. The event's Results page shows it for a finish-position event.
 */
export function RaceFinishingOrderPanel({ event }: { event: SportEventDto }) {
  const fieldQuery = useSportEventFieldQuery(event.id);
  const field = fieldQuery.data ?? [];

  return (
    <div className="space-y-6" data-testid="root-admin-race-results-panel">
      {fieldQuery.isError ? (
        <Alert data-testid="root-admin-race-result-field-error" tone="danger">
          {extractErrorMessage(fieldQuery.error, {
            fallback: 'We could not load the field, so the current result is not shown and a finishing order cannot be loaded.',
          })}
        </Alert>
      ) : null}
      {fieldQuery.isSuccess ? (
        <>
          <StoredFinishingOrder event={event} field={field} />
          {/* Only once the field is read, so the official box starts from the stored result. */}
          <FinishingOrderUploadCard event={event} field={field} />
        </>
      ) : null}
    </div>
  );
}
