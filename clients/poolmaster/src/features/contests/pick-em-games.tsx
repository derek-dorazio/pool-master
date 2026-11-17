import { Lock } from 'lucide-react';
import { PickEmMode, type PickOutcome } from '@poolmaster/shared/domain';
import {
  Chip,
  cn,
  formatDateTimeDisplay,
  FormField,
  Select,
  Text,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { describePickOutcome } from './bracket-layout';
import { EmptyPickSlot } from './empty-pick-slot';
import { EventScheduleChip } from './event-schedule-chip';
import { GameCard } from './game-card';
import { PickedLine, PickOption } from './pick-option';
import { confidenceOptions, gameTeams, isSurvivorWeek, isTeamUsed, isTiePicked, teamSpread, type PickEmGame, type PickEmTeam, type PickEmWeek } from './pick-em-week';

/** A survivor pick's mark (#719): its team won, or the entry is out. */
const SURVIVOR_OUTCOME_LABELS: Record<PickOutcome, string> = {
  CORRECT: 'Survived',
  BUSTED: 'Out',
  // A survivor pick is never scored against the spread, so never a push.
  PUSH: 'Push',
  PENDING: 'Pending',
};

/** How a pick stands against its game: a survivor pick reads as surviving or going out. */
function pickOutcome(gamePicks: PickEmWeek, pick: NonNullable<PickEmGame['pick']>) {
  const outcome = describePickOutcome(pick);
  return outcome && isSurvivorWeek(gamePicks) && pick.outcome !== null
    ? { ...outcome, label: SURVIVOR_OUTCOME_LABELS[pick.outcome] }
    : outcome;
}

/** A pool's tie pick (#792): what the sport calls a game that ends level, and its save. */
export interface PickEmTie {
  /** "Draw" in soccer, "Tie" elsewhere. */
  label: string;
  onPick: (game: PickEmGame) => void;
}

/** The team's name, with its spread beside it when the pool is scored against the spread (#720). */
function TeamName({ game, spread, team }: { game: PickEmGame; spread: string | null; team: PickEmTeam }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{team.name}</span>
      {spread === null ? null : (
        <Text className="shrink-0 tabular-nums" data-testid={`pick-em-game-${game.matchNumber}-spread-${team.sportEventParticipantId}`} variant="caption">
          {spread}
        </Text>
      )}
    </span>
  );
}

/**
 * The middle choice of a game in a pool that takes tie picks (#792): the game ends level, called
 * by the sport's word ("Draw" in soccer). A button while the game can change, a line after.
 */
function TieChoice({
  choosable,
  game,
  isBusy,
  isPicked,
  label,
  onPick,
}: {
  choosable: boolean;
  game: PickEmGame;
  isBusy: boolean;
  isPicked: boolean;
  label: string;
  onPick: (game: PickEmGame) => void;
}) {
  const testId = `pick-em-game-${game.matchNumber}-tie`;
  return choosable ? (
    <PickOption isBusy={isBusy} isPicked={isPicked} onPick={() => onPick(game)} testId={testId}>
      <span>{label}</span>
    </PickOption>
  ) : (
    <PickedLine isPicked={isPicked} testId={testId}>
      <span>{label}</span>
    </PickedLine>
  );
}

/** A confidence pool's value for the game's pick: chosen while the game can change, shown after. */
function ConfidenceValue({
  canChange,
  game,
  gamePicks,
  isBusy,
  onChange,
}: {
  canChange: boolean;
  game: PickEmGame;
  /** The week, for its game count and the values its games already kicked off hold. */
  gamePicks: PickEmWeek;
  isBusy: boolean;
  onChange: (game: PickEmGame, value: number | null) => void;
}) {
  const value = game.pick?.confidence ?? null;
  if (!canChange || !game.pick) {
    return game.pick ? (
      <Text as="p" data-testid={`pick-em-game-${game.matchNumber}-confidence-value`}>
        {value === null ? 'Not ranked' : `Confidence ${value}`}
      </Text>
    ) : null;
  }
  return (
    <FormField label="Confidence">
      <Select
        data-testid={`pick-em-game-${game.matchNumber}-confidence`}
        disabled={isBusy}
        onChange={(event) => onChange(game, event.target.value === '' ? null : Number(event.target.value))}
        value={value === null ? '' : String(value)}
      >
        <option value="">Choose a value</option>
        {confidenceOptions(gamePicks, game).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </Select>
    </FormField>
  );
}

function PickEmGameCard({
  canChange,
  game,
  gamePicks,
  isBusy,
  onConfidence,
  onPick,
  tie,
}: {
  canChange: boolean;
  game: PickEmGame;
  gamePicks: PickEmWeek;
  isBusy: boolean;
  onConfidence: (game: PickEmGame, value: number | null) => void;
  onPick: (game: PickEmGame, team: PickEmTeam) => void;
  tie: PickEmTie;
}) {
  const displayPreferences = useDisplayPreferences();
  const choosable = canChange && !game.locked;
  // Another entry's pick stays hidden until the game kicks off.
  const isHidden = !gamePicks.ownEntry && !game.revealed;
  const pickedId = game.pick?.sportEventParticipantId ?? null;
  // A pick is only marked against the result once its game is under way.
  const outcome = game.pick && (game.locked || game.revealed) ? pickOutcome(gamePicks, game.pick) : null;
  const isTiebreakerGame = game.sportEventMatchId === gamePicks.tiebreakerMatchId;
  const tiebreakerShown = gamePicks.tiebreakerValue !== null;
  return (
    <GameCard
      aside={(
        <>
          <EventScheduleChip status={game.status} testId={`pick-em-game-${game.matchNumber}-schedule`} />
          {isTiebreakerGame ? <Chip tone="info">Tiebreaker game</Chip> : null}
          {game.locked ? (
            <span className="inline-flex items-center gap-1" data-testid={`pick-em-game-${game.matchNumber}-locked`}>
              <Lock aria-hidden size={13} />
              Locked
            </span>
          ) : null}
          {outcome ? <Chip data-testid={`pick-em-game-${game.matchNumber}-outcome`} tone={outcome.tone}>{outcome.label}</Chip> : null}
        </>
      )}
      label={<span data-testid={`pick-em-game-${game.matchNumber}-kickoff`}>{formatDateTimeDisplay(game.kickoff, displayPreferences)}</span>}
      testId={`pick-em-game-${game.matchNumber}`}
    >
      <div className={cn('grid gap-2', gamePicks.tiePicksOffered ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {gameTeams(game).flatMap((team, index) => {
          // A pool that takes tie picks offers the tie between the two teams (#792).
          const tieChoice = index === 1 && gamePicks.tiePicksOffered ? [(
            <TieChoice
              choosable={choosable}
              game={game}
              isBusy={isBusy}
              isPicked={!isHidden && isTiePicked(game)}
              key="tie"
              label={tie.label}
              onPick={tie.onPick}
            />
          )] : [];
          if (!team) {
            return [...tieChoice, (
              <EmptyPickSlot key={index}>To be decided</EmptyPickSlot>
            )];
          }
          const isPicked = !isHidden && team.sportEventParticipantId === pickedId;
          const spread = teamSpread(gamePicks, game, team);
          const testId = `pick-em-game-${game.matchNumber}-team-${team.sportEventParticipantId}`;
          return [...tieChoice, choosable ? (
            <PickOption
              isBusy={isBusy}
              isPicked={isPicked}
              isUsed={isTeamUsed(gamePicks, team)}
              key={team.sportEventParticipantId}
              onPick={() => onPick(game, team)}
              testId={testId}
            >
              <TeamName game={game} spread={spread} team={team} />
            </PickOption>
          ) : (
            <PickedLine isPicked={isPicked} key={team.sportEventParticipantId} testId={testId}>
              <TeamName game={game} spread={spread} team={team} />
            </PickedLine>
          )];
        })}
      </div>
      {isHidden ? (
        <Text as="p" data-testid={`pick-em-game-${game.matchNumber}-hidden`} variant="meta">
          This pick is shown at kickoff.
        </Text>
      ) : null}
      {gamePicks.mode === PickEmMode.CONFIDENCE && !isHidden ? (
        <ConfidenceValue canChange={choosable} game={game} gamePicks={gamePicks} isBusy={isBusy} onChange={onConfidence} />
      ) : null}
      {/* While the game can be picked, its tiebreaker is typed in the Name and submit card (#1769). */}
      {isTiebreakerGame && !choosable && (gamePicks.ownEntry || tiebreakerShown) ? (
        <Text as="p" data-testid="pick-em-tiebreaker-summary">
          {tiebreakerShown ? `Tiebreaker: ${gamePicks.tiebreakerValue} total points.` : 'No tiebreaker was saved.'}
        </Text>
      ) : null}
    </GameCard>
  );
}

/**
 * A pick'em week's games in kickoff order (#718): a tap on a team picks it, a confidence pool
 * ranks each pick, and the tiebreaker game is marked (its number is typed in the Name and submit card). A pool that takes tie picks (#792)
 * offers the tie between the two teams. In a survivor week (#719) the tap
 * replaces the entry's one pick, and a team it used in another week can't be tapped. A game that has kicked off is locked
 * and marked against its result; on another entry each pick shows from its game's kickoff.
 */
export function PickEmGames({
  canChange,
  gamePicks,
  isBusy,
  onConfidence,
  onPick,
  tie,
}: {
  /** Whether the viewer may change this week now: their own entry, before its games lock. */
  canChange: boolean;
  gamePicks: PickEmWeek;
  /** A save is under way: the choices wait for the server's answer. */
  isBusy: boolean;
  onConfidence: (game: PickEmGame, value: number | null) => void;
  onPick: (game: PickEmGame, team: PickEmTeam) => void;
  /** The tie choice, shown on each game when the pool takes tie picks (`tiePicksOffered`). */
  tie: PickEmTie;
}) {
  const games = [...gamePicks.games].sort(
    (left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff) || left.matchNumber - right.matchNumber,
  );
  if (games.length === 0) {
    return <Text as="p" data-testid="pick-em-no-games" variant="meta">This week has no games to pick.</Text>;
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2" data-testid="pick-em-games">
      {games.map((game) => (
        <PickEmGameCard
          canChange={canChange}
          game={game}
          gamePicks={gamePicks}
          isBusy={isBusy}
          key={game.sportEventMatchId}
          onConfidence={onConfidence}
          onPick={onPick}
          tie={tie}
        />
      ))}
    </ul>
  );
}
