import { getSportDefinition, MatchResultSource, MatchStatus, SportEventStatus } from '@poolmaster/shared/domain';
import type { SportEventDto, SportEventMatchDto } from '@/lib/api';
import { Notice, Heading, SectionCard, SimpleTable, TableBody, TableHead, TableHeaderCell } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { formsNoBracket, matchNoun } from './bracket-copy';
import { BracketMatchRow } from './bracket-match-row';
import type { BracketContext } from './bracket-match-write';
import { PlayInPlacesCard } from './play-in-places-card';
import { ReseedRoundsCard } from './reseed-rounds-card';
import { WithdrawalsCard } from './withdrawals-card';
import { useEventMatchPeriods, useEventRoundLabel } from './use-sport-catalog';
import { useSportEventBracketQuery, useSportEventFieldQuery } from './use-sport-event';
import { useProvidersQuery } from './use-providers-query';
import { upperFirst } from '@/lib/upper-first';

/** Whether a match shows a score from the data feed: a synced result, or a live game's score. */
function showsFeedScore(match: SportEventMatchDto): boolean {
  return match.resultSource === MatchResultSource.PROVIDER || match.status === MatchStatus.IN_PROGRESS;
}

/**
 * A bracket event's results page (#698, #700): its matches round by round, each round named by
 * the sport and each match called what the sport calls it ("game" for basketball). Before
 * release an admin edits pairings and marks play-in places; once released one tap names a
 * match's winner and each play-in place takes its winner. For a league that reseeds, each round
 * placed by seed is suggested and saved on its own card (#785). A participant who withdraws
 * before their first match is replaced on the withdrawals card (#704).
 */
export function BracketPanel({ event }: { event: SportEventDto }) {
  const definition = getSportDefinition(event.sport);
  const bracketQuery = useSportEventBracketQuery(event.id);
  const fieldQuery = useSportEventFieldQuery(event.id);
  const roundLabel = useEventRoundLabel(event);
  const periods = useEventMatchPeriods(event);
  // The feed's name is read only once one of its scores is on the bracket (#1496).
  const fromFeed = (bracketQuery.data ?? []).some(showsFeedScore);
  const providersQuery = useProvidersQuery({ enabled: fromFeed });
  // poolmaster-allow-list-lookup: the few data providers, with no read of one
  const feedName = providersQuery.data?.find((provider) => provider.providerId === event.providerId)?.providerName ?? 'the data feed';

  if (bracketQuery.isError || fieldQuery.isError) {
    return (
      <Notice data-testid="root-admin-bracket-error" title="Couldn't load the bracket" tone="danger">
        {extractErrorMessage(bracketQuery.error ?? fieldQuery.error, { fallback: 'Try again in a moment.' })}
      </Notice>
    );
  }
  if (!bracketQuery.data || !fieldQuery.data) {
    return <p className="text-sm text-muted-foreground">Loading the bracket...</p>;
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
    periods,
    // A week of games forms no bracket, so none of its games goes to a shoot-out (#791).
    shootout: bracket.length > 0 && !formsNoBracket(bracket) ? definition.shootout : null,
    feedName,
  };
  const roundCount = Math.max(event.rounds ?? 0, ...bracket.map((match) => match.roundNumber));
  const roundNumbers = [...new Set(bracket.map((match) => match.roundNumber))].sort((left, right) => left - right);

  return (
    <div className="space-y-6">
      <SectionCard headingLevel={3} padded title="Bracket">
        {bracket.length > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="root-admin-bracket-help">
            {released
              ? `Choose the ${vocabulary.participant.one} that won each ${noun.one}. The winner moves on to its next ${noun.one}.`
              : `Pairings can change until the ${vocabulary.event.one} is released. Results are entered after that.`}
          </p>
        ) : null}
        {bracket.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="root-admin-bracket-empty">
            {`No bracket yet. Its ${noun.many} are loaded before the ${vocabulary.event.one} is released.`}
          </p>
        ) : roundNumbers.map((roundNumber) => (
          <section className="mt-4" data-testid={`root-admin-bracket-round-${roundNumber}`} key={roundNumber}>
            <Heading level={4} variant="label">{roundLabel(roundNumber, roundCount)}</Heading>
            <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
              <SimpleTable className="min-w-full">
                <TableHead>
                  <tr>
                    <TableHeaderCell>{upperFirst(noun.one)}</TableHeaderCell>
                    <TableHeaderCell>Pairing</TableHeaderCell>
                    {context.spreads ? <TableHeaderCell>Spread</TableHeaderCell> : null}
                    <TableHeaderCell>Time</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>{released ? 'Winner' : 'Edit'}</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {bracket.filter((match) => match.roundNumber === roundNumber).map((match) => (
                    <BracketMatchRow context={context} key={match.id} match={match} released={released} />
                  ))}
                </TableBody>
              </SimpleTable>
            </div>
          </section>
        ))}
      </SectionCard>
      <ReseedRoundsCard context={context} event={event} roundCount={roundCount} roundLabel={roundLabel} />
      <PlayInPlacesCard event={event} field={fieldQuery.data} vocabulary={vocabulary} />
      <WithdrawalsCard bracket={bracket} event={event} field={fieldQuery.data} vocabulary={vocabulary} />
    </div>
  );
}
