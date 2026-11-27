import { displayString, enumLabel } from '@poolmaster/shared/display-strings';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ContestEntryStatus,
  PickEmMode,
  formatPickEmRulesName,
  formatSelectionTypeName,
} from '@poolmaster/shared/domain';
import type { ContestDto, SaveGamePicksRequest } from '@/lib/api';
import {
  Notice,
  ErrorState,
  formatDateTimeDisplay,
  FormField,
  LoadingState,
  SectionCard,
  Select,
  StatStrip,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { buildHowToPlayFormatPath } from '@/features/event-pages/event-page-paths';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { formatEntryScore } from './bracket-layout';
import { ContestEventSwitcher } from './contest-event-switcher';
import { entryEventStatus, eventOfCurrentSlot } from './contest-events';
import { ContestEntryFrame } from './contest-header';
import { EntryFinishCard } from './entry-finish-card';
import { entryFinishStatus, entryStatusLine } from './entry-status-line';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { useContestLeagueCode } from './use-contest-league';
import { contestEventStart, contestMatchNoun, contestParticipantNoun, contestScoreUnit, contestTieLabel, gamePickErrorValues } from './contest-sport';
import {
  canRenameEntries,
} from './contest-status';
import { PickEmGames } from './pick-em-games';
import {
  canChangeWeek,
  confidencePicks,
  currentWeekRound,
  firstKickoff,
  isPlayoffSurvivor,
  isSurvivorWeek,
  missedWeek,
  roundWeek,
  survivorPickTeam,
  teamPick,
  tiebreakerLabel,
  tiePick,
  weekRounds,
  weekSubmitHint,
  type PickEmGame,
  type PickEmTeam,
} from './pick-em-week';
import { useEventRoundNames } from './use-bracket-round-label';
import { useContestEntryQuery } from './use-contest-entries';
import { gameEntryFinish, SUBMIT_CLOSED } from './game-entry-finish';
import { useEntryName } from './use-entry-name';
import { useGamePicks } from './use-game-picks';
import { TiebreakerNumberField } from './tiebreaker-number-field';

/**
 * A pick'em contest's entry page (#718): one week at a time, with a switcher for the season's
 * weeks. The entry's own week takes a pick on each game, a confidence value in a confidence pool,
 * the tiebreaker on the week's last game, and a submit before the first kickoff; after that its
 * picks lock game by game. Another entry's week shows each pick from its game's kickoff.
 *
 * A survivor contest's week (#719) is the same screen with one pick: a tap picks the team, in
 * place of the entry's other pick; teams used in another week can't be picked, there is no
 * tiebreaker, and an entry that is out picks no more weeks. On a playoff bracket (#785) each
 * round is a week: a round switcher shows one round at a time, read as its own week.
 */
export function PickEmEntryPage({ contest }: { contest: ContestDto }) {
  const displayPreferences = useDisplayPreferences();
  const { entryId = '' } = useParams<{ entryId: string }>();
  const contestId = contest.id;
  // The week being picked, else the latest played, until the member switches.
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);
  const sportEventId = requestedEventId ?? eventOfCurrentSlot(contest)?.sportEventId ?? '';
  // A playoff survivor pool's round on screen (#785), until the member switches: the one being picked.
  const [requestedRound, setRequestedRound] = useState<number | null>(null);
  const eventRounds = useEventRoundNames(sportEventId);
  const nameOfRound = eventRounds.nameOfRound;
  const tieLabel = contestTieLabel(contest.sport);
  const match = contestMatchNoun(contest.sport);
  const participant = contestParticipantNoun(contest.sport);
  const eventStart = contestEventStart(contest.sport);

  const { gamePicksQuery, saveMutation, setTiebreakerDraft, submitMutation, tiebreakerDraft } = useGamePicks({
    action: 'pickEm',
    contest,
    entryId,
    feature: 'pick-em-entry-page',
    sportEventId,
    submitInvalidates: [
      QueryKeys.contests.pickEmLeaderboard(contestId),
      QueryKeys.contests.survivorLeaderboard(contestId),
    ],
  });
  const entryQuery = useContestEntryQuery(contestId, entryId);
  const leagueCode = useContestLeagueCode();
  const navigate = useNavigate();
  const name = useEntryName({ contestId, entryId, savedName: gamePicksQuery.data?.entryName ?? '' });

  const switchWeek = (next: string) => {
    saveMutation.reset();
    submitMutation.reset();
    setTiebreakerDraft(null);
    setRequestedRound(null);
    setRequestedEventId(next);
  };

  // The page waits for its event's round names too, so a round never shows as "Round N" first (#2200).
  if (gamePicksQuery.isLoading || entryQuery.isLoading || eventRounds.isLoading) {
    return <LoadingState body="Loading picks..." />;
  }
  if (gamePicksQuery.isError || !gamePicksQuery.data) {
    return (
      <ErrorState
        body="We couldn't load these picks."
        onRetry={() => void gamePicksQuery.refetch()}
        testId="pick-em-entry-error"
      />
    );
  }

  const eventPicks = gamePicksQuery.data;
  const isPlayoff = isPlayoffSurvivor(eventPicks);
  const rounds = weekRounds(eventPicks);
  const round = requestedRound !== null && rounds.includes(requestedRound) ? requestedRound : currentWeekRound(eventPicks);
  // A playoff round reads as a week of its own; any other event is one week.
  const gamePicks = isPlayoff ? roundWeek(eventPicks, round) : eventPicks;
  /** What one pick covers: a week, or a playoff's round. */
  const period = isPlayoff ? 'round' : 'week';
  const entrySummary = entryQuery.data?.entry ?? null;
  const canChange = canChangeWeek(gamePicks);
  const isSubmitted = gamePicks.status === ContestEntryStatus.SUBMITTED;
  const kickoff = firstKickoff(gamePicks.games);
  const isSurvivor = isSurvivorWeek(gamePicks);
  const eliminatedInWeek = gamePicks.survivor?.eliminatedInWeek ?? null;
  // A contest of one playoff event counts its weeks by the event's rounds.
  const eliminatedRound = isPlayoff && contest.sportEvents.length === 1 && eliminatedInWeek !== null ? rounds.at(eliminatedInWeek - 1) ?? null : null;
  // A used team names the week it was picked in; a week that is one of this playoff's rounds, by the round's name.
  const usedWeekName = (weekNumber: number) => {
    const round = isPlayoff ? eventPicks.survivor?.roundWeeks.find((week) => week.weekNumber === weekNumber)?.roundNumber : undefined;
    return round === undefined ? displayString('word.weekNumber', { n: weekNumber }) : nameOfRound(round);
  };
  const eliminatedIn = eliminatedRound !== null ? `the ${nameOfRound(eliminatedRound)}` : `week ${eliminatedInWeek ?? ''}`;
  // poolmaster-allow-position: weekRounds sorts round numbers ascending: the lowest is the first round
  const roundNeedsPick = isPlayoff && round !== rounds.at(0) && canChangeWeek(gamePicks) && gamePicks.pickedCount === 0;
  const survivorTeam = isSurvivor ? survivorPickTeam(gamePicks) : null;

  const save = (body: SaveGamePicksRequest) => {
    saveMutation.reset();
    saveMutation.mutate(body);
  };
  const pick = (game: PickEmGame, team: PickEmTeam) => save({ picks: [teamPick(game, team, gamePicks.mode)] });
  const pickTie = (game: PickEmGame) => save({ picks: [tiePick(game, gamePicks.mode)] });
  // A pool that takes tie picks (#792) says so where it says how to pick.
  const pickInstruction = gamePicks.tiePicksOffered
    ? `Tap the team you think wins each game, or ${tieLabel} if you think it ends level`
    : 'Tap the team you think wins each game';
  const rank = (game: PickEmGame, value: number | null) => {
    const picks = confidencePicks(gamePicks.games, game, value);
    if (picks.length) {
      save({ picks });
    }
  };
  const errorMessage = (error: Error | null, fallback: string) => (error
    ? extractErrorMessage(error, { context: ['pickEm', 'gamePicks'], values: gamePickErrorValues(contest.sport), fallback })
    : null);
  // A save with no picks is the tiebreaker's, from the Name and submit card.
  const pickError = saveMutation.variables?.picks.length === 0 ? null : errorMessage(saveMutation.error, 'We could not save that pick. Please try again.');

  // Each pick locks at its own game's kickoff, so a submitted week says that rather than one time.
  const locks = isSurvivor ? 'your pick locks at its kickoff' : 'each pick locks at its kickoff';
  // When the week's picks close, in the words the status line and the card use.
  const closes = kickoff ? formatDateTimeDisplay(kickoff, displayPreferences) : `the ${eventStart}`;
  const statusLine = !gamePicks.ownEntry
    ? entryStatusLine({ closes, isOpen: false, status: gamePicks.status })
    : eliminatedInWeek !== null
    ? `Out in ${eliminatedIn}`
    : missedWeek(gamePicks)
    ? `Not submitted before the ${eventStart} · ${isSurvivor ? 'out' : 'scores nothing'}`
    : roundNeedsPick
    ? `No pick yet · pick a ${participant.one} before this round's first ${match.one}`
    : entryStatusLine({ closes, isOpen: canChange, locks, status: gamePicks.status });

  // The Name and submit card: the name, the tiebreaker while its game is open, and one button.
  const tiebreakerGameOpen = canChange && gamePicks.games.some((game) => game.sportEventRoundMatchId === gamePicks.tiebreakerMatchId && !game.locked);
  const tiebreakerFieldLabel = tiebreakerGameOpen ? tiebreakerLabel(gamePicks, contestScoreUnit(contest.sport)) : null;
  const submits = canChange && !isSubmitted;
  const {
    canSubmit, finish, finishError, isChanged, isFinishing, tiebreakerInvalid, tiebreakerText, typedTiebreaker,
  } = gameEntryFinish({
    canSubmit: gamePicks.canSubmit,
    errorMessage,
    name,
    // A submitted week returns to the contest's page (#1739).
    onSubmitted: () => void navigate(buildLeagueContestPath(leagueCode, contestId)),
    savedTiebreaker: gamePicks.tiebreakerValue,
    submitFallback: 'We could not submit this week. Please try again.',
    submits,
    tiebreakerMax: gamePicks.tiebreakerMax,
    writes: { saveMutation, submitMutation, tiebreakerDraft },
  });
  // What still blocks Submit, counting a tiebreaker typed but not yet saved: the button saves it first.
  const hint = weekSubmitHint(
    { ...gamePicks, tiebreakerValue: typedTiebreaker ?? gamePicks.tiebreakerValue },
    { tiebreakerOpen: tiebreakerGameOpen },
  ) ?? (canSubmit ? null : SUBMIT_CLOSED);
  const nameEditable = gamePicks.ownEntry && canRenameEntries(contest);

  return (
    <ContestEntryFrame
      contest={contest}
      entry={entrySummary}
      leagueCode={leagueCode}
      phaseLabel={enumLabel('ContestStatus', contest.status)}
      rules={[
        ...(gamePicks.mode ? [formatPickEmRulesName({ mode: gamePicks.mode, againstTheSpread: gamePicks.againstTheSpread })] : []),
        ...(isSurvivor ? [formatSelectionTypeName(gamePicks.selectionType)] : []),
      ]}
      status={gamePicks.status}
      statusLine={statusLine}
      testId="pick-em-entry-page"
      title={gamePicks.entryName}
    >

      <ContestEventSwitcher
        describe={(sportEvent) => (entrySummary ? enumLabel('ContestEntryStatus', entryEventStatus(entrySummary, sportEvent.sportEventId)) : null)}
        events={contest.sportEvents}
        label={displayString('word.week')}
        onChange={switchWeek}
        testId="pick-em-week-switcher"
        value={sportEventId}
      />
      {isPlayoff ? (
        <FormField className="max-w-md" label="Round">
          <Select data-testid="survivor-round-switcher" onChange={(event) => setRequestedRound(Number(event.target.value))} value={String(round)}>
            {rounds.map((roundNumber) => (
              <option key={roundNumber} value={roundNumber}>{nameOfRound(roundNumber)}</option>
            ))}
          </Select>
        </FormField>
      ) : null}

      <StatStrip
        items={isSurvivor ? [
          { label: 'Your pick', value: survivorTeam?.name ?? 'None yet', testId: 'survivor-pick' },
          { label: 'Status', value: eliminatedInWeek === null ? 'In' : 'Out', testId: 'survivor-status' },
        ] : [
          { label: 'Picked', value: `${gamePicks.pickedCount} of ${gamePicks.gameCount}`, testId: 'pick-em-picked-count' },
          { label: 'Points', value: formatEntryScore(gamePicks.points), testId: 'pick-em-points' },
          { label: 'Max', value: formatEntryScore(gamePicks.maxPossiblePoints), testId: 'pick-em-max-possible' },
        ]}
        testId="pick-em-progress"
      />

      {pickError ? <Notice data-testid="pick-em-pick-error" tone="danger">{pickError}</Notice> : null}

      <SectionCard
        headingLevel={3}
        help={canChange ? (isSurvivor
          ? `Tap the one ${participant.one} you think wins this ${period}. If that pick loses, the entry is out. A ${participant.one} you picked in another ${period} can't be picked again. Your pick locks when its ${match.one} starts.`
          : gamePicks.mode === PickEmMode.CONFIDENCE
          ? `${pickInstruction}, then rank your picks from ${gamePicks.gameCount}, the one you're surest of, down to 1. A correct pick scores its value. Each pick locks at its game's kickoff.`
          : `${pickInstruction}. Each correct pick scores 1 point. Each pick locks at its game's kickoff.`) : undefined}
        helpLink={canChange ? { label: 'How to play', to: buildHowToPlayFormatPath(contest.sportUrlSegment ?? null, contest.selectionType) } : undefined}
        padded
        testId="pick-em-picks"
        title={canChange ? (isSurvivor ? 'Pick a winner' : 'Pick each game') : 'Picks'}
        titleTestId="contest-entry-builder-heading"
      >
        <PickEmGames
          canChange={canChange}
          gamePicks={gamePicks}
          isBusy={saveMutation.isPending}
          onConfidence={rank}
          onPick={pick}
          tie={{ label: tieLabel, onPick: pickTie }}
          weekName={usedWeekName}
        />
      </SectionCard>

      {gamePicks.ownEntry && (submits || isSubmitted || nameEditable) ? (
        <EntryFinishCard
          action={submits ? {
            disabled: hint !== null || !canSubmit || tiebreakerInvalid || !name.isValid || isFinishing,
            isBusy: isFinishing,
            label: isPlayoff ? 'Submit entry' : 'Submit week',
            onClick: () => void finish(),
            testId: 'pick-em-submit',
          } : isChanged ? {
            disabled: tiebreakerInvalid || !name.isValid || isFinishing,
            isBusy: isFinishing,
            label: 'Save',
            onClick: () => void finish(),
            testId: 'pick-em-save',
          } : null}
          error={finishError}
          errorTestId="pick-em-submit-error"
          name={nameEditable ? { disabled: isFinishing, onChange: name.onChange, testId: 'contest-entry-name-input', value: name.value } : null}
          status={canChange || isSubmitted ? entryFinishStatus({ closes, hint, isSubmitted, locks }) : enumLabel('ContestEntryStatus', gamePicks.status)}
          statusTestId="pick-em-finish-status"
          testId="pick-em-finish"
          title="Name and submit"
        >
          {tiebreakerFieldLabel ? (
            <TiebreakerNumberField
              disabled={isFinishing}
              label={tiebreakerFieldLabel}
              max={gamePicks.tiebreakerMax}
              onChange={setTiebreakerDraft}
              testId="pick-em-tiebreaker-input"
              text={tiebreakerText}
            />
          ) : null}
        </EntryFinishCard>
      ) : null}
    </ContestEntryFrame>
  );
}
