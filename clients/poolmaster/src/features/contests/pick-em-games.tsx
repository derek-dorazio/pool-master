import { Lock } from 'lucide-react';
import { PickEmMode, type PickOutcome } from '@poolmaster/shared/domain';
import { GAME_PICKS_TIEBREAKER_MAX } from '@poolmaster/shared/dto';
import { Button, Chip, FormField, Input, Select, cn, formatDateTimeDisplay, useDisplayPreferences } from '@/features/shared/ui';
import type { GamePicksResponse } from '@/lib/api';
import { describePickOutcome, parseBracketTiebreaker } from './bracket-layout';
import { PickedLine, PickOption } from './pick-option';
import { confidenceOptions, describeMatchup, gameTeams, isSurvivorWeek, isTeamUsed, isTiePicked, teamSpread, type PickEmGame, type PickEmTeam } from './pick-em-week';

/** A survivor pick's mark (#719): its team won, or the entry is out. */
const SURVIVOR_OUTCOME_LABELS: Record<PickOutcome, string> = {
  CORRECT: 'Survived',
  BUSTED: 'Out',
  // A survivor pick is never scored against the spread, so never a push.
  PUSH: 'Push',
  PENDING: 'Pending',
};

/** How a pick stands against its game: a survivor pick reads as surviving or going out. */
function pickOutcome(gamePicks: GamePicksResponse, pick: NonNullable<PickEmGame['pick']>) {
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

/** The tiebreaker's draft and its save, owned by the page: the field sits on its game's card. */
export interface PickEmTiebreaker {
  isSaving: boolean;
  onChange: (text: string) => void;
  onSave: (value: number) => void;
  /** Why the last tiebreaker save was refused, or null. */
  saveError: string | null;
  text: string;
}

/** The team's name, with its spread beside it when the pool is scored against the spread (#720). */
function TeamName({ game, spread, team }: { game: PickEmGame; spread: string | null; team: PickEmTeam }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{team.name}</span>
      {spread === null ? null : (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-testid={`pick-em-game-${game.matchNumber}-spread-${team.sportEventParticipantId}`}>
          {spread}
        </span>
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
  gamePicks: GamePicksResponse;
  isBusy: boolean;
  onChange: (game: PickEmGame, value: number | null) => void;
}) {
  const value = game.pick?.confidence ?? null;
  if (!canChange || !game.pick) {
    return game.pick ? (
      <p className="text-sm" data-testid={`pick-em-game-${game.matchNumber}-confidence-value`}>
        {value === null ? 'Not ranked' : `Confidence ${value}`}
      </p>
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

/** The week's tiebreaker, on its game's card: typed and saved until that game kicks off. */
function TiebreakerField({ game, gamePicks, tiebreaker }: { game: PickEmGame; gamePicks: GamePicksResponse; tiebreaker: PickEmTiebreaker }) {
  const parsed = parseBracketTiebreaker(tiebreaker.text);
  const isTyped = tiebreaker.text.trim() !== '';
  const isUnchanged = parsed !== null && parsed === gamePicks.tiebreakerValue;
  return (
    <form
      className="space-y-2"
      data-testid="pick-em-tiebreaker"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed !== null && !isUnchanged) {
          tiebreaker.onSave(parsed);
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <FormField
          className="min-w-[10rem] flex-1"
          error={isTyped && parsed === null ? `Enter a whole number from 0 to ${GAME_PICKS_TIEBREAKER_MAX}.` : undefined}
          helperText={`Total points in ${describeMatchup(game)}, both teams together. It only breaks a tie on points.`}
          label="Tiebreaker"
        >
          <Input
            data-testid="pick-em-tiebreaker-input"
            disabled={tiebreaker.isSaving}
            inputMode="numeric"
            max={GAME_PICKS_TIEBREAKER_MAX}
            min={0}
            onChange={(event) => tiebreaker.onChange(event.target.value)}
            type="number"
            value={tiebreaker.text}
          />
        </FormField>
        <Button
          data-testid="pick-em-tiebreaker-save"
          disabled={parsed === null || isUnchanged || tiebreaker.isSaving}
          type="submit"
          variant="secondary"
        >
          {tiebreaker.isSaving ? 'Saving...' : 'Save tiebreaker'}
        </Button>
      </div>
      {gamePicks.tiebreakerValue !== null ? (
        <p className="text-sm text-muted-foreground" data-testid="pick-em-tiebreaker-saved">
          {`Saved tiebreaker: ${gamePicks.tiebreakerValue} total points.`}
        </p>
      ) : null}
      {tiebreaker.saveError ? (
        <p className="text-sm text-destructive" data-testid="pick-em-tiebreaker-error">{tiebreaker.saveError}</p>
      ) : null}
    </form>
  );
}

function GameCard({
  canChange,
  game,
  gamePicks,
  isBusy,
  onConfidence,
  onPick,
  tie,
  tiebreaker,
}: {
  canChange: boolean;
  game: PickEmGame;
  gamePicks: GamePicksResponse;
  isBusy: boolean;
  onConfidence: (game: PickEmGame, value: number | null) => void;
  onPick: (game: PickEmGame, team: PickEmTeam) => void;
  tie: PickEmTie;
  tiebreaker: PickEmTiebreaker;
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
    <li className="space-y-3 rounded-2xl border border-border bg-background p-4" data-testid={`pick-em-game-${game.matchNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid={`pick-em-game-${game.matchNumber}-kickoff`}>{formatDateTimeDisplay(game.kickoff, displayPreferences)}</span>
        <span className="flex flex-wrap items-center gap-2">
          {isTiebreakerGame ? <Chip tone="info">Tiebreaker game</Chip> : null}
          {game.locked ? (
            <span className="inline-flex items-center gap-1" data-testid={`pick-em-game-${game.matchNumber}-locked`}>
              <Lock aria-hidden size={13} />
              Locked
            </span>
          ) : null}
          {outcome ? <Chip data-testid={`pick-em-game-${game.matchNumber}-outcome`} tone={outcome.tone}>{outcome.label}</Chip> : null}
        </span>
      </div>
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
              <div className="flex h-9 items-center rounded-2xl border border-dashed border-border px-3 text-sm text-muted-foreground" key={index}>
                To be decided
              </div>
            )];
          }
          const isPicked = !isHidden && team.sportEventParticipantId === pickedId;
          const spread = teamSpread(gamePicks, game, team);
          return [...tieChoice, choosable ? (
            <PickOption
              isBusy={isBusy}
              isPicked={isPicked}
              isUsed={isTeamUsed(gamePicks, team)}
              key={team.sportEventParticipantId}
              onPick={() => onPick(game, team)}
              testId={`pick-em-game-${game.matchNumber}-team-${team.sportEventParticipantId}`}
            >
              <TeamName game={game} spread={spread} team={team} />
            </PickOption>
          ) : (
            <PickedLine isPicked={isPicked} key={team.sportEventParticipantId} testId={`pick-em-game-${game.matchNumber}-team-${team.sportEventParticipantId}`}>
              <TeamName game={game} spread={spread} team={team} />
            </PickedLine>
          )];
        })}
      </div>
      {isHidden ? (
        <p className="text-sm text-muted-foreground" data-testid={`pick-em-game-${game.matchNumber}-hidden`}>
          This pick is shown at kickoff.
        </p>
      ) : null}
      {gamePicks.mode === PickEmMode.CONFIDENCE && !isHidden ? (
        <ConfidenceValue canChange={choosable} game={game} gamePicks={gamePicks} isBusy={isBusy} onChange={onConfidence} />
      ) : null}
      {isTiebreakerGame && choosable ? (
        <TiebreakerField game={game} gamePicks={gamePicks} tiebreaker={tiebreaker} />
      ) : isTiebreakerGame && (gamePicks.ownEntry || tiebreakerShown) ? (
        <p className="text-sm" data-testid="pick-em-tiebreaker-summary">
          {tiebreakerShown ? `Tiebreaker: ${gamePicks.tiebreakerValue} total points.` : 'No tiebreaker was saved.'}
        </p>
      ) : null}
    </li>
  );
}

/**
 * A pick'em week's games in kickoff order (#718): a tap on a team picks it, a confidence pool
 * ranks each pick, and the tiebreaker is typed on its game. A pool that takes tie picks (#792)
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
  tiebreaker,
}: {
  /** Whether the viewer may change this week now: their own entry, before its games lock. */
  canChange: boolean;
  gamePicks: GamePicksResponse;
  /** A save is under way: the choices wait for the server's answer. */
  isBusy: boolean;
  onConfidence: (game: PickEmGame, value: number | null) => void;
  onPick: (game: PickEmGame, team: PickEmTeam) => void;
  /** The tie choice, shown on each game when the pool takes tie picks (`tiePicksOffered`). */
  tie: PickEmTie;
  tiebreaker: PickEmTiebreaker;
}) {
  const games = [...gamePicks.games].sort(
    (left, right) => Date.parse(left.kickoff) - Date.parse(right.kickoff) || left.matchNumber - right.matchNumber,
  );
  if (games.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="pick-em-no-games">This week has no games to pick.</p>;
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2" data-testid="pick-em-games">
      {games.map((game) => (
        <GameCard
          canChange={canChange}
          game={game}
          gamePicks={gamePicks}
          isBusy={isBusy}
          key={game.sportEventMatchId}
          onConfidence={onConfidence}
          onPick={onPick}
          tie={tie}
          tiebreaker={tiebreaker}
        />
      ))}
    </ul>
  );
}
