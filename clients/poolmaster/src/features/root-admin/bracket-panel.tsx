import { getSportDefinition, SportEventStatus } from '@poolmaster/shared/domain';
import type { SportEventDto } from '@/lib/api';
import { Alert, Tile } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { formsNoBracket, matchNoun } from './bracket-copy';
import { BracketMatchRow, type BracketContext } from './bracket-match-row';
import { capitalize } from './manage-navigation';
import { PlayInPlacesCard } from './play-in-places-card';
import { useEventRoundLabel } from './use-sport-catalog';
import { useSportEventBracketQuery, useSportEventFieldQuery } from './use-sport-event';

/**
 * A bracket event's results page (#698, #700): its matches round by round, each round named by
 * the sport and each match called what the sport calls it ("game" for basketball). Before
 * release an admin edits pairings and marks play-in places; once released one tap names a
 * match's winner and each play-in place takes its winner.
 */
export function BracketPanel({ event }: { event: SportEventDto }) {
  const definition = getSportDefinition(event.sport);
  const bracketQuery = useSportEventBracketQuery(event.id);
  const fieldQuery = useSportEventFieldQuery(event.id);
  const roundLabel = useEventRoundLabel(event);

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
  const vocabulary = definition.vocabulary;
  const noun = matchNoun(vocabulary);
  const released = event.status !== SportEventStatus.DRAFT;
  const context: BracketContext = {
    eventId: event.id,
    vocabulary,
    bracket,
    field: fieldQuery.data,
    fieldById: new Map(fieldQuery.data.map((entry) => [entry.id, entry])),
    spreads: bracket.length > 0 && formsNoBracket(bracket),
  };
  const roundCount = Math.max(event.rounds ?? 0, ...bracket.map((match) => match.roundNumber));
  const roundNumbers = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);

  return (
    <div className="space-y-6">
      <Tile>
        <h3 className="text-base font-semibold text-foreground">Bracket</h3>
        {bracket.length > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="root-admin-bracket-help">
            {released
              ? `Choose the ${vocabulary.participant.one} that won each ${noun.one}. The winner moves on to its next ${noun.one}.`
              : `Pairings can change until the ${vocabulary.event.one} is released. Results are entered after that.`}
          </p>
        ) : null}
        {bracket.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="root-admin-bracket-empty">
            {`No bracket yet. Its ${noun.many} are loaded before the ${vocabulary.event.one} is released.`}
          </p>
        ) : roundNumbers.map((roundNumber) => (
          <section className="mt-4" data-testid={`root-admin-bracket-round-${roundNumber}`} key={roundNumber}>
            <h4 className="text-sm font-semibold text-foreground">{roundLabel(roundNumber, roundCount)}</h4>
            <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">{capitalize(noun.one)}</th>
                    <th className="px-4 py-2">Pairing</th>
                    {context.spreads ? <th className="px-4 py-2">Spread</th> : null}
                    <th className="px-4 py-2">Time</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">{released ? 'Winner' : 'Edit'}</th>
                  </tr>
                </thead>
                <tbody>
                  {bracket.filter((match) => match.roundNumber === roundNumber).map((match) => (
                    <BracketMatchRow context={context} key={match.id} match={match} released={released} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </Tile>
      <PlayInPlacesCard event={event} field={fieldQuery.data} vocabulary={vocabulary} />
    </div>
  );
}
