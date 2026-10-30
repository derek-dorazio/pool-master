import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BracketAdvancement, MatchSide, SportEventStatus } from '@poolmaster/shared/domain';
import { proposeEventRoundMatchups, setEventRoundMatchups } from '@/lib/api';
import type { RoundMatchupDto, SportEventDto } from '@/lib/api';
import { Button, Heading, InlineError, PanelCard, Select } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { describeEntry, matchNoun, ReseedAction, reseededRounds, reseedErrorMessages, roundStarted, unfinishedBefore } from './bracket-copy';
import type { BracketContext } from './bracket-match-row';
import { capitalize } from './manage-navigation';
import { useSportLeaguesQuery } from './use-sport-catalog';

const logger = getLogger().child({ feature: 'root-admin-reseed' });

const SIDES = [MatchSide.AWAY, MatchSide.HOME] as const;

type RoundLabel = (roundNumber: number, roundCount: number) => string;

/** "1", "1 and 4", "1, 2 and 4". */
function listNumbers(numbers: readonly number[]): string {
  return numbers.length <= 1 ? numbers.join('') : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

/**
 * Reseeded rounds on the bracket tab (#722, #785). For a sport league that reseeds (the NFL after
 * Wild Card weekend), each round placed by seed that has not started can be suggested from the
 * seeds, adjusted, and saved in one go. Shown only once the event is released.
 */
export function ReseedRoundsCard({
  event,
  context,
  roundLabel,
  roundCount,
}: {
  event: SportEventDto;
  context: BracketContext;
  roundLabel: RoundLabel;
  roundCount: number;
}) {
  const leaguesQuery = useSportLeaguesQuery(event.sport);
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const league = leaguesQuery.data?.find((candidate) => candidate.id === event.sportLeagueId);
  // Only a released event still being played places rounds: not a draft, a cancelled or a finished one.
  const underWay = event.status === SportEventStatus.SCHEDULED || event.status === SportEventStatus.IN_PROGRESS;
  if (!underWay || league?.bracketAdvancement !== BracketAdvancement.RESEED_BY_SEED) {
    return null;
  }
  const rounds = reseededRounds(context.bracket).filter((roundNumber) => !roundStarted(context.bracket, roundNumber));
  if (rounds.length === 0) {
    return null;
  }
  const team = context.vocabulary.participant;

  return (
    <PanelCard headingLevel={3} padded testId="root-admin-reseed" title="Reseeded rounds">
      <p className="text-sm text-muted-foreground">
        {`The ${team.many} left are paired by seed: the best seed left hosts the worst. Suggest the ${matchNoun(context.vocabulary).many}, change any that need it, then save them.`}
      </p>
      {rounds.map((roundNumber) => (
        <ReseedRound context={context} key={roundNumber} roundCount={roundCount} roundLabel={roundLabel} roundNumber={roundNumber} />
      ))}
    </PanelCard>
  );
}

function ReseedRound({
  context,
  roundNumber,
  roundLabel,
  roundCount,
}: {
  context: BracketContext;
  roundNumber: number;
  roundLabel: RoundLabel;
  roundCount: number;
}) {
  const { eventId, vocabulary, bracket, fieldById } = context;
  const noun = matchNoun(vocabulary);
  const team = vocabulary.participant;
  const [requested, setRequested] = useState(false);
  // The admin's changes over the suggestion, keyed `${matchNumber}-${side}`: the suggestion itself
  // stays server state, so a refetch never overwrites a change.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const unfinished = unfinishedBefore(bracket, roundNumber);
  const ready = unfinished.length === 0;

  const proposalQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.reseedProposal(eventId, roundNumber),
    queryFn: async (): Promise<RoundMatchupDto[]> => {
      const response = await proposeEventRoundMatchups({ path: { eventId, roundNumber } });
      if (!response.data?.matches) {
        throwApiError(response.error, 'Reseed proposal response is missing data.');
      }
      return response.data.matches;
    },
    enabled: requested && ready,
    retry: false,
    // A suggestion refetched on focus would only repeat itself; results invalidate it instead.
    refetchOnWindowFocus: false,
  });

  const proposal = proposalQuery.data;
  const sideValue = (matchup: RoundMatchupDto, side: MatchSide) =>
    edits[`${matchup.matchNumber}-${side}`]
      ?? (side === MatchSide.HOME ? matchup.homeSportEventParticipantId : matchup.awaySportEventParticipantId);
  const matchups: RoundMatchupDto[] = (proposal ?? []).map((matchup) => ({
    matchNumber: matchup.matchNumber,
    homeSportEventParticipantId: sideValue(matchup, MatchSide.HOME),
    awaySportEventParticipantId: sideValue(matchup, MatchSide.AWAY),
  }));
  const picks = matchups.flatMap((matchup) => [matchup.homeSportEventParticipantId, matchup.awaySportEventParticipantId]);
  const repeated = new Set(picks).size < picks.length;

  const mutation = useInvalidatingMutation({
    mutationFn: async (matches: RoundMatchupDto[]) => {
      const response = await setEventRoundMatchups({ path: { eventId, roundNumber }, body: { matches } });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    // The bracket now names both sides of every match of the round; its key covers the suggestion.
    invalidates: [QueryKeys.rootAdmin.manageSport.bracket(eventId)],
    onSuccess: () => {
      setRequested(false);
      setEdits({});
      setSaved(true);
    },
    onError: (error, matches) => {
      logger.warn({ action: 'event.reseed.set.failed', data: { roundNumber, matches: matches.length }, err: error }, 'Reseeded round matchups were rejected');
    },
  });

  const roundMatches = new Map(bracket.filter((match) => match.roundNumber === roundNumber).map((match) => [match.matchNumber, match]));
  const regionOf = (matchNumber: number) => roundMatches.get(matchNumber)?.regionLabel ?? null;
  /** The teams of the suggestion that can play in this match: those in its own region. */
  const optionsFor = (matchNumber: number) => (proposal ?? [])
    .filter((matchup) => regionOf(matchup.matchNumber) === regionOf(matchNumber))
    .flatMap((matchup) => [matchup.homeSportEventParticipantId, matchup.awaySportEventParticipantId])
    .flatMap((rowId) => {
      const entry = fieldById.get(rowId);
      return entry ? [entry] : [];
    })
    .sort((left, right) => (left.seedNumber ?? Number.MAX_SAFE_INTEGER) - (right.seedNumber ?? Number.MAX_SAFE_INTEGER));

  const before = roundLabel(roundNumber - 1, roundCount);
  const unfinishedNoun = unfinished.length === 1 ? noun.one : noun.many;

  return (
    <section className="mt-4" data-testid={`root-admin-reseed-round-${roundNumber}`}>
      <Heading level={4} variant="label">{roundLabel(roundNumber, roundCount)}</Heading>
      {ready ? null : (
        <p className="mt-1 text-sm text-muted-foreground" data-testid={`root-admin-reseed-waiting-${roundNumber}`}>
          {`Enter the result of every ${before} ${noun.one} first. ${capitalize(unfinishedNoun)} ${listNumbers(unfinished.map((match) => match.matchNumber))} ${unfinished.length === 1 ? 'has' : 'have'} no result yet.`}
        </p>
      )}
      {saved && !requested ? (
        <p className="mt-1 text-sm text-muted-foreground" data-testid={`root-admin-reseed-saved-${roundNumber}`} role="status">
          {`${capitalize(noun.many)} saved. They can change until the round starts.`}
        </p>
      ) : null}
      {!requested || !ready ? (
        <Button
          className="mt-2"
          data-testid={`root-admin-reseed-suggest-${roundNumber}`}
          disabled={!ready}
          onClick={() => {
            setSaved(false);
            setRequested(true);
          }}
          size="sm"
          variant="secondary"
        >
          {`Suggest ${noun.many}`}
        </Button>
      ) : null}
      {requested && ready && proposalQuery.isPending ? (
        <p className="mt-2 text-sm text-muted-foreground">{`Suggesting ${noun.many}…`}</p>
      ) : null}
      {requested && ready && proposalQuery.isError ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <InlineError testId={`root-admin-reseed-error-${roundNumber}`}>
            {extractErrorMessage(proposalQuery.error, {
              codeMessages: reseedErrorMessages(vocabulary, ReseedAction.SUGGEST),
              fallback: `The ${noun.many} could not be suggested. Try again.`,
            })}
          </InlineError>
          <Button onClick={() => void proposalQuery.refetch()} size="sm" variant="ghost">Try again</Button>
        </div>
      ) : null}
      {requested && ready && proposal ? (
        <div className="mt-2 space-y-3">
          <ul className="space-y-2">
            {matchups.map((matchup) => (
              <li className="flex flex-wrap items-end gap-3" data-testid={`root-admin-reseed-match-${matchup.matchNumber}`} key={matchup.matchNumber}>
                <span className="min-w-20 text-sm font-medium">{`${capitalize(noun.one)} ${matchup.matchNumber}`}</span>
                {SIDES.map((side) => (
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground" key={side}>
                    {side === MatchSide.HOME ? 'Home' : 'Away'}
                    <Select
                      aria-label={`${side === MatchSide.HOME ? 'Home' : 'Away'} ${team.one} for ${noun.one} ${matchup.matchNumber}`}
                      data-testid={`root-admin-reseed-${matchup.matchNumber}-${side}`}
                      disabled={mutation.isPending}
                      onChange={(change) => {
                        const value = change.target.value;
                        setEdits((current) => ({ ...current, [`${matchup.matchNumber}-${side}`]: value }));
                      }}
                      value={side === MatchSide.HOME ? matchup.homeSportEventParticipantId : matchup.awaySportEventParticipantId}
                    >
                      {optionsFor(matchup.matchNumber).map((entry) => (
                        <option key={entry.id} value={entry.id}>{describeEntry(entry)}</option>
                      ))}
                    </Select>
                  </label>
                ))}
              </li>
            ))}
          </ul>
          {repeated ? (
            <InlineError testId={`root-admin-reseed-repeated-${roundNumber}`}>
              {`Each ${team.one} plays once. Pick a different ${team.one} where one appears twice.`}
            </InlineError>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid={`root-admin-reseed-save-${roundNumber}`}
              disabled={repeated || mutation.isPending}
              onClick={() => mutation.mutate(matchups)}
              size="sm"
            >
              {mutation.isPending ? 'Saving…' : `Save ${noun.many}`}
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                setRequested(false);
                setEdits({});
                mutation.reset();
              }}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
          {mutation.isError ? (
            <InlineError testId={`root-admin-reseed-save-error-${roundNumber}`}>
              {extractErrorMessage(mutation.error, {
                codeMessages: reseedErrorMessages(vocabulary, ReseedAction.SAVE),
                fallback: `The ${noun.many} could not be saved. Try again.`,
              })}
            </InlineError>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
