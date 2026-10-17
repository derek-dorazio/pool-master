import { getSportDefinition, MatchSide, MatchStatus } from '@poolmaster/shared/domain';
import type { SportEventDto, SportEventMatchDto, SportEventParticipantDto } from '@/lib/api';
import { Alert, formatDateTimeDisplay, StatusBadge, Tile } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { useSportEventBracketQuery, useSportEventFieldQuery } from './use-sport-event';

const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  [MatchStatus.SCHEDULED]: 'Scheduled',
  [MatchStatus.IN_PROGRESS]: 'In progress',
  [MatchStatus.COMPLETED]: 'Final',
  [MatchStatus.CANCELLED]: 'Cancelled',
};

const MATCH_STATUS_TONE: Record<MatchStatus, 'neutral' | 'active' | 'final' | 'warning'> = {
  [MatchStatus.SCHEDULED]: 'neutral',
  [MatchStatus.IN_PROGRESS]: 'active',
  [MatchStatus.COMPLETED]: 'final',
  [MatchStatus.CANCELLED]: 'warning',
};

/** A side's team, with its seed, or who fills it while that is still to be decided. */
function describeSide(
  match: SportEventMatchDto,
  side: MatchSide,
  fieldById: ReadonlyMap<string, SportEventParticipantDto>,
  bracket: readonly SportEventMatchDto[],
): string {
  const sportEventParticipantId = side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
  const entry = sportEventParticipantId === null ? undefined : fieldById.get(sportEventParticipantId);
  if (entry) {
    return entry.seedNumber === null ? entry.participant.name : `(${entry.seedNumber}) ${entry.participant.name}`;
  }
  const feeder = bracket.find((other) => other.advancesToMatchId === match.id && other.advancesToSide === side);
  return feeder ? `Winner of match ${feeder.matchNumber}` : 'To be decided';
}

/** "Duke vs Vermont" on a neutral site, "Bills @ Chiefs" otherwise. */
function describePairing(
  match: SportEventMatchDto,
  fieldById: ReadonlyMap<string, SportEventParticipantDto>,
  bracket: readonly SportEventMatchDto[],
): string {
  const home = describeSide(match, MatchSide.HOME, fieldById, bracket);
  const away = describeSide(match, MatchSide.AWAY, fieldById, bracket);
  return match.isNeutralSite ? `${home} vs ${away}` : `${away} @ ${home}`;
}

/**
 * A bracket event's results page (#698): its matches round by round, each with its pairing, its
 * time and where it stands. Results entry follows with knockout scoring (#699).
 */
export function BracketPanel({ event }: { event: SportEventDto }) {
  const definition = getSportDefinition(event.sport);
  const bracketQuery = useSportEventBracketQuery(event.id);
  const fieldQuery = useSportEventFieldQuery(event.id);

  if (bracketQuery.isError || fieldQuery.isError) {
    return (
      <Alert data-testid="root-admin-bracket-error" title="Couldn't load the bracket" tone="danger">
        {extractErrorMessage(bracketQuery.error ?? fieldQuery.error, { fallback: 'Try again in a moment.' })}
      </Alert>
    );
  }
  if (!bracketQuery.data || !fieldQuery.data) {
    return <p className="text-sm text-muted-foreground">Loading the bracket…</p>;
  }

  const bracket = bracketQuery.data;
  const fieldById = new Map(fieldQuery.data.map((entry) => [entry.id, entry]));
  const roundCount = Math.max(event.rounds ?? 0, ...bracket.map((match) => match.roundNumber));
  const roundNumbers = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);

  return (
    <Tile>
      <h3 className="text-base font-semibold text-foreground">Bracket</h3>
      {bracket.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="root-admin-bracket-empty">
          {`No bracket yet. Its matches are loaded before the ${definition.vocabulary.event.one} is released.`}
        </p>
      ) : roundNumbers.map((roundNumber) => (
        <section className="mt-4" data-testid={`root-admin-bracket-round-${roundNumber}`} key={roundNumber}>
          <h4 className="text-sm font-semibold text-foreground">{definition.roundLabel(roundNumber, roundCount)}</h4>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Match</th>
                  <th className="px-4 py-2">Pairing</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {bracket.filter((match) => match.roundNumber === roundNumber).map((match) => (
                  <tr className="border-t border-border" data-testid={`root-admin-bracket-match-${match.matchNumber}`} key={match.id}>
                    <td className="px-4 py-2 font-medium">{match.matchNumber}</td>
                    <td className="px-4 py-2" data-testid={`root-admin-bracket-pairing-${match.matchNumber}`}>
                      {describePairing(match, fieldById, bracket)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDateTimeDisplay(match.scheduledDate, 'To be announced')}</td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={MATCH_STATUS_TONE[match.status]}>{MATCH_STATUS_LABEL[match.status]}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </Tile>
  );
}
