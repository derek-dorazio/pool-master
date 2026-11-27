import { enumLabel } from '@poolmaster/shared/display-strings';
import { GameSideStatus, sportVocabulary, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import type { SportEventDto, SportEventParticipantDto } from '@/lib/api';
import {
  Notice,
  formatOrdinal,
  SectionCard,
  SimpleTable,
  StatusBadge,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { useSportEventFieldQuery } from './use-sport-event';
import { upperFirst } from '@/lib/upper-first';

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
  const vocabulary = sportVocabulary(event.sport);
  const official = isStoredResultOfficial(field);
  const hasResults = field.some((entry) => entry.race !== null);

  return (
    <SectionCard
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
        <p className="text-sm text-muted-foreground" data-testid="root-admin-race-result-empty">
          {`No results yet. The ${vocabulary.round.one}'s result comes from the feed once it is run.`}
        </p>
      ) : (
        <>
          {!official ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Contests count these places once the result is official.
            </p>
          ) : null}
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <SimpleTable className="min-w-full" data-testid="root-admin-race-result-table">
              <TableHead>
                <tr>
                  <TableHeaderCell>Finish</TableHeaderCell>
                  <TableHeaderCell>{upperFirst(vocabulary.participant.one)}</TableHeaderCell>
                  <TableHeaderCell>Start</TableHeaderCell>
                  {vocabulary.rider !== undefined ? <TableHeaderCell>{vocabulary.rider}</TableHeaderCell> : null}
                </tr>
              </TableHead>
              <TableBody>
                {[...field].sort(byFinish).map((entry) => {
                  const { race } = entry;
                  const finish = !race
                    ? ((entry.status === SportEventParticipantStatus.ACTIVE) ? '—' : vocabulary.withdrawn)
                    : race.resultStatus === GameSideStatus.FINISHED
                      ? (race.finishPosition === null ? '—' : formatOrdinal(race.finishPosition))
                      : enumLabel('GameSideStatus', race.resultStatus);
                  return (
                    <TableRow data-testid={`root-admin-race-result-row-${entry.id}`} key={entry.id}>
                      <TableCell className="font-medium" data-testid={`root-admin-race-result-finish-${entry.id}`}>{finish}</TableCell>
                      <TableCell>{entry.participant.name}</TableCell>
                      <TableCell className="text-muted-foreground">{race?.startPosition ?? '—'}</TableCell>
                      {vocabulary.rider !== undefined ? (
                        <TableCell className="text-muted-foreground">{race?.riderName ?? '—'}</TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </SimpleTable>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/**
 * Finish position's results (#623): the race's stored result, which comes from the feed (#2008).
 * The event's Results page shows it for a finish-position event.
 */
export function RaceFinishingOrderPanel({ event }: { event: SportEventDto }) {
  const fieldQuery = useSportEventFieldQuery(event.id);
  const field = fieldQuery.data ?? [];

  return (
    <div className="space-y-6" data-testid="root-admin-race-results-panel">
      {fieldQuery.isError ? (
        <Notice data-testid="root-admin-race-result-field-error" tone="danger">
          {extractErrorMessage(fieldQuery.error, {
            fallback: 'We could not load the field, so the current result is not shown.',
          })}
        </Notice>
      ) : null}
      {fieldQuery.isSuccess ? (
        <StoredFinishingOrder event={event} field={field} />
      ) : null}
    </div>
  );
}
