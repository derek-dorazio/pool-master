import { ContestEntryStatus, PickEmMode } from '@poolmaster/shared/domain';
import type { GamePicksResponse, SaveGamePicksRequest } from '@/lib/api';

/**
 * A pick'em week as its screen reads it (#718): which games the entry can still pick, what is
 * left before it can submit, and the picks a confidence change saves. The server decides every
 * rule; these only shape its answer for the screen.
 */

export type PickEmGame = GamePicksResponse['games'][number];
export type PickEmTeam = NonNullable<PickEmGame['home']>;
type GamePickWrite = SaveGamePicksRequest['picks'][number];

/** The game's two teams, away first, as a schedule lists them: "Bills at Chiefs". */
export function gameTeams(game: PickEmGame): [PickEmTeam | null, PickEmTeam | null] {
  return [game.predictedAway, game.predictedHome];
}

/** "Bills at Chiefs", or "Bills vs Chiefs" at a neutral site. */
export function describeMatchup(game: PickEmGame): string {
  const [away, home] = gameTeams(game);
  return `${away?.name ?? 'To be decided'} ${game.isNeutralSite ? 'vs' : 'at'} ${home?.name ?? 'To be decided'}`;
}

/** The week's first kickoff: a draft week still unsubmitted then scores nothing. Null for a week with no games. */
export function firstKickoff(games: readonly PickEmGame[]): string | null {
  return games.reduce<string | null>(
    (first, game) => (first === null || Date.parse(game.kickoff) < Date.parse(first) ? game.kickoff : first),
    null,
  );
}

/** The game whose total points the week's tiebreaker guesses, or null while the week has none. */
export function tiebreakerGame(gamePicks: Pick<GamePicksResponse, 'games' | 'tiebreakerMatchId'>): PickEmGame | null {
  return gamePicks.games.find((game) => game.sportEventMatchId === gamePicks.tiebreakerMatchId) ?? null;
}

/**
 * Whether the entry's own week can still change. A submitted week takes changes on every game
 * that hasn't kicked off; a week still in draft at its first kickoff missed it, and is locked.
 */
export function canChangeWeek(gamePicks: Pick<GamePicksResponse, 'games' | 'ownEntry' | 'status'>): boolean {
  if (!gamePicks.ownEntry || !gamePicks.games.some((game) => !game.locked)) {
    return false;
  }
  return gamePicks.status === ContestEntryStatus.SUBMITTED || !gamePicks.games.some((game) => game.locked);
}

/** The entry's own week, still in draft after its first kickoff: it scores nothing. */
export function missedWeek(gamePicks: Pick<GamePicksResponse, 'games' | 'ownEntry' | 'status'>): boolean {
  return gamePicks.ownEntry
    && gamePicks.status === ContestEntryStatus.DRAFT
    && gamePicks.games.some((game) => game.locked);
}

/** A pick of the team, keeping the game's confidence value in a confidence pool. */
export function teamPick(game: PickEmGame, team: PickEmTeam, mode: GamePicksResponse['mode']): GamePickWrite {
  return {
    sportEventMatchId: game.sportEventMatchId,
    sportEventParticipantId: team.sportEventParticipantId,
    ...(mode === PickEmMode.CONFIDENCE ? { confidence: game.pick?.confidence ?? null } : {}),
  };
}

/**
 * The picks that give a game a confidence value. A value is used once, so when another game the
 * entry can still change holds it, the two swap in one save: that game takes this one's old value,
 * or none. A game that has kicked off keeps its value, and the repeat is the entry's to fix.
 */
export function confidencePicks(games: readonly PickEmGame[], game: PickEmGame, value: number | null): GamePickWrite[] {
  if (!game.pick) {
    return [];
  }
  const picks: GamePickWrite[] = [{
    sportEventMatchId: game.sportEventMatchId,
    sportEventParticipantId: game.pick.sportEventParticipantId,
    confidence: value,
  }];
  const holder = value === null
    ? undefined
    : games.find((other) => other.sportEventMatchId !== game.sportEventMatchId && !other.locked && other.pick?.confidence === value);
  if (holder?.pick) {
    picks.push({
      sportEventMatchId: holder.sportEventMatchId,
      sportEventParticipantId: holder.pick.sportEventParticipantId,
      confidence: game.pick.confidence,
    });
  }
  return picks;
}

/** What still keeps a confidence week from submitting: picks with no value, and values used twice. */
function confidenceHint(gamePicks: GamePicksResponse): string | null {
  const values = gamePicks.games.flatMap((game) => (game.pick ? [game.pick.confidence] : []));
  const missing = values.filter((value) => value === null).length;
  if (missing > 0) {
    return `Rank every pick from 1 to ${gamePicks.gameCount}: ${missing} still to rank.`;
  }
  if (new Set(values).size < values.length) {
    return `Use each value from 1 to ${gamePicks.gameCount} once: a value is on more than one pick.`;
  }
  return null;
}

/** Why the week cannot be submitted yet, in the order the entry would fix it, or null. */
export function weekSubmitHint(gamePicks: GamePicksResponse): string | null {
  const stillToPick = gamePicks.gameCount - gamePicks.pickedCount;
  if (stillToPick > 0) {
    return `Pick every game to submit: ${stillToPick} still to pick.`;
  }
  if (gamePicks.mode === PickEmMode.CONFIDENCE) {
    const hint = confidenceHint(gamePicks);
    if (hint) {
      return hint;
    }
  }
  if (gamePicks.tiebreakerValue === null) {
    return 'Save your tiebreaker to submit.';
  }
  return null;
}
