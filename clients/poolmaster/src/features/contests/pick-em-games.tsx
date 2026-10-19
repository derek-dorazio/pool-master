import { Check, Lock } from 'lucide-react';
import { PickEmMode } from '@poolmaster/shared/domain';
import { GAME_PICKS_TIEBREAKER_MAX } from '@poolmaster/shared/dto';
import { Button, Chip, FormField, Input, Select, cn, formatDateTimeDisplay } from '@/features/shared/ui';
import type { GamePicksResponse } from '@/lib/api';
import { describePickOutcome, parseBracketTiebreaker } from './bracket-layout';
import { describeMatchup, gameTeams, type PickEmGame, type PickEmTeam } from './pick-em-week';

/** The tiebreaker's draft and its save, owned by the page: the field sits on its game's card. */
export interface PickEmTiebreaker {
  isSaving: boolean;
  onChange: (text: string) => void;
  onSave: (value: number) => void;
  /** Why the last tiebreaker save was refused, or null. */
  saveError: string | null;
  text: string;
}

function TeamChoice({
  game,
  isBusy,
  isPicked,
  onPick,
  team,
}: {
  game: PickEmGame;
  isBusy: boolean;
  isPicked: boolean;
  onPick: (game: PickEmGame, team: PickEmTeam) => void;
  team: PickEmTeam;
}) {
  return (
    <Button
      aria-pressed={isPicked}
      className="w-full justify-between text-left"
      data-testid={`pick-em-game-${game.matchNumber}-team-${team.sportEventParticipantId}`}
      disabled={isBusy}
      onClick={() => {
        if (!isPicked) {
          onPick(game, team);
        }
      }}
      size="sm"
      variant={isPicked ? 'subtle' : 'secondary'}
    >
      <span className="truncate">{team.name}</span>
      {isPicked ? <Check aria-label="Your pick" size={16} /> : null}
    </Button>
  );
}

function TeamLine({ game, isPicked, team }: { game: PickEmGame; isPicked: boolean; team: PickEmTeam }) {
  return (
    <div
      className={cn(
        'flex h-9 items-center justify-between gap-2 rounded-2xl border px-3 text-sm',
        isPicked ? 'border-primary/30 bg-primary/10 font-semibold' : 'border-border text-muted-foreground',
      )}
      data-picked={isPicked || undefined}
      data-testid={`pick-em-game-${game.matchNumber}-team-${team.sportEventParticipantId}`}
    >
      <span className="truncate">{team.name}</span>
      {isPicked ? <Check aria-label="Picked" size={16} /> : null}
    </div>
  );
}

/** A confidence pool's value for the game's pick: chosen while the game can change, shown after. */
function ConfidenceValue({
  canChange,
  game,
  gameCount,
  isBusy,
  onChange,
}: {
  canChange: boolean;
  game: PickEmGame;
  gameCount: number;
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
        {Array.from({ length: gameCount }, (_, index) => gameCount - index).map((option) => (
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
  tiebreaker,
}: {
  canChange: boolean;
  game: PickEmGame;
  gamePicks: GamePicksResponse;
  isBusy: boolean;
  onConfidence: (game: PickEmGame, value: number | null) => void;
  onPick: (game: PickEmGame, team: PickEmTeam) => void;
  tiebreaker: PickEmTiebreaker;
}) {
  const choosable = canChange && !game.locked;
  // Another entry's pick stays hidden until the game kicks off.
  const isHidden = !gamePicks.ownEntry && !game.revealed;
  const pickedId = game.pick?.sportEventParticipantId ?? null;
  // A pick is only marked against the result once its game is under way.
  const outcome = game.pick && (game.locked || game.revealed) ? describePickOutcome(game.pick) : null;
  const isTiebreakerGame = game.sportEventMatchId === gamePicks.tiebreakerMatchId;
  const tiebreakerShown = gamePicks.tiebreakerValue !== null;
  return (
    <li className="space-y-3 rounded-2xl border border-border bg-background p-4" data-testid={`pick-em-game-${game.matchNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid={`pick-em-game-${game.matchNumber}-kickoff`}>{formatDateTimeDisplay(game.kickoff)}</span>
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
      <div className="grid gap-2 sm:grid-cols-2">
        {gameTeams(game).map((team, index) => {
          if (!team) {
            return (
              <div className="flex h-9 items-center rounded-2xl border border-dashed border-border px-3 text-sm text-muted-foreground" key={index}>
                To be decided
              </div>
            );
          }
          const isPicked = !isHidden && team.sportEventParticipantId === pickedId;
          return choosable ? (
            <TeamChoice game={game} isBusy={isBusy} isPicked={isPicked} key={team.sportEventParticipantId} onPick={onPick} team={team} />
          ) : (
            <TeamLine game={game} isPicked={isPicked} key={team.sportEventParticipantId} team={team} />
          );
        })}
      </div>
      {isHidden ? (
        <p className="text-sm text-muted-foreground" data-testid={`pick-em-game-${game.matchNumber}-hidden`}>
          This pick is shown at kickoff.
        </p>
      ) : null}
      {gamePicks.mode === PickEmMode.CONFIDENCE && !isHidden ? (
        <ConfidenceValue canChange={choosable} game={game} gameCount={gamePicks.gameCount} isBusy={isBusy} onChange={onConfidence} />
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
 * ranks each pick, and the tiebreaker is typed on its game. A game that has kicked off is locked
 * and marked against its result; on another entry each pick shows from its game's kickoff.
 */
export function PickEmGames({
  canChange,
  gamePicks,
  isBusy,
  onConfidence,
  onPick,
  tiebreaker,
}: {
  /** Whether the viewer may change this week now: their own entry, before its games lock. */
  canChange: boolean;
  gamePicks: GamePicksResponse;
  /** A save is under way: the choices wait for the server's answer. */
  isBusy: boolean;
  onConfidence: (game: PickEmGame, value: number | null) => void;
  onPick: (game: PickEmGame, team: PickEmTeam) => void;
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
          tiebreaker={tiebreaker}
        />
      ))}
    </ul>
  );
}
