import { ContestEntryStatus, PickEmMode, SelectionType } from '@poolmaster/shared/domain';
import type { GamePicksResponse, SaveGamePicksRequest } from '@/lib/api';

/**
 * A pick'em week as its screen reads it (#718): which games the entry can still pick, what is
 * left before it can submit, and the picks a confidence change saves. A survivor week (#719) is
 * read on the same screen: one pick, of a team the entry has not used. The server decides every
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

/** "-3.5", "+7", or "PK" for a pick'em line: a spread as a sportsbook prints it. */
export function formatSpread(spread: number): string {
  if (spread === 0) {
    return 'PK';
  }
  return spread > 0 ? `+${spread}` : String(spread);
}

/**
 * The spread a team plays the game at (#720), as shown beside it when the pool is scored against
 * the spread: the home spread for the home team and its opposite for the away team. Null when the
 * pool is not against the spread or the game has no spread yet.
 */
export function teamSpread(
  gamePicks: Pick<GamePicksResponse, 'againstTheSpread'>,
  game: Pick<PickEmGame, 'home' | 'homeSpread'>,
  team: PickEmTeam,
): string | null {
  if (!gamePicks.againstTheSpread || game.homeSpread === null) {
    return null;
  }
  const isHome = team.sportEventParticipantId === game.home?.sportEventParticipantId;
  return formatSpread(isHome ? game.homeSpread : -game.homeSpread);
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
 * that hasn't kicked off; a week still in draft at its first kickoff missed it, and is locked. A
 * survivor entry that is out changes nothing.
 */
export function canChangeWeek(gamePicks: Pick<GamePicksResponse, 'games' | 'ownEntry' | 'selectionType' | 'status' | 'survivor'>): boolean {
  if (!gamePicks.ownEntry || isEliminated(gamePicks) || !gamePicks.games.some((game) => !game.locked)) {
    return false;
  }
  // A survivor week's one pick, once its game kicks off, is the week's: no other pick replaces it.
  if (isSurvivorWeek(gamePicks) && gamePicks.games.some((game) => game.locked && game.pick !== null)) {
    return false;
  }
  return gamePicks.status === ContestEntryStatus.SUBMITTED || !gamePicks.games.some((game) => game.locked);
}

/** Whether the week is a survivor week (#719): one pick, of a team not used before. */
export function isSurvivorWeek(gamePicks: Pick<GamePicksResponse, 'selectionType'>): boolean {
  return gamePicks.selectionType === SelectionType.SURVIVOR;
}

/** A survivor entry that is out: it picks no later week. */
export function isEliminated(gamePicks: Pick<GamePicksResponse, 'survivor'>): boolean {
  return (gamePicks.survivor?.eliminatedInWeek ?? null) !== null;
}

/** Whether the survivor entry picked the team in another week it submitted, so cannot pick it again. */
export function isTeamUsed(gamePicks: Pick<GamePicksResponse, 'survivor'>, team: PickEmTeam): boolean {
  return gamePicks.survivor?.usedParticipantIds?.includes(team.participantId) ?? false;
}

/** The team a survivor week's pick names, or null with none shown. */
export function survivorPickTeam(gamePicks: Pick<GamePicksResponse, 'games'>): PickEmTeam | null {
  for (const game of gamePicks.games) {
    const pickedId = game.pick?.sportEventParticipantId;
    const team = gameTeams(game).find((candidate) => candidate !== null && candidate.sportEventParticipantId === pickedId);
    if (team) {
      return team;
    }
  }
  return null;
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

/**
 * The confidence values a game's pick may take: 1 to the week's game count, largest first, leaving out the values held
 * by games that have kicked off, since those picks can no longer give their value up.
 */
export function confidenceOptions(gamePicks: Pick<GamePicksResponse, 'gameCount' | 'games'>, game: PickEmGame): number[] {
  const { gameCount, games } = gamePicks;
  const held = new Set(games.flatMap((other) => (
    other.sportEventMatchId !== game.sportEventMatchId && other.locked && other.pick?.confidence != null
      ? [other.pick.confidence]
      : []
  )));
  return Array.from({ length: gameCount }, (_, index) => gameCount - index).filter((value) => !held.has(value));
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
  if (isSurvivorWeek(gamePicks)) {
    return gamePicks.pickedCount === 0 ? 'Pick one team to submit.' : null;
  }
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

/**
 * The event's rounds, in order. A regular-season week has one; a survivor pool on a playoff
 * bracket (#785) picks each round as a week of its own.
 */
export function weekRounds(gamePicks: Pick<GamePicksResponse, 'games'>): number[] {
  return [...new Set(gamePicks.games.map((game) => game.roundNumber))].sort((left, right) => left - right);
}

/** Whether the week is a survivor pool's playoff bracket (#785): several rounds, a pick in each. */
export function isPlayoffSurvivor(gamePicks: Pick<GamePicksResponse, 'games' | 'selectionType'>): boolean {
  return isSurvivorWeek(gamePicks) && weekRounds(gamePicks).length > 1;
}

/**
 * The round a playoff survivor screen opens on: the first with a game still to kick off, else
 * the last.
 */
export function currentWeekRound(gamePicks: Pick<GamePicksResponse, 'games'>): number {
  const rounds = weekRounds(gamePicks);
  return rounds.find((round) => gamePicks.games.some((game) => game.roundNumber === round && !game.locked)) ?? rounds.at(-1) ?? 1;
}

/** The participant the game's pick names, or null with none shown. */
function pickedParticipantId(game: PickEmGame): string | null {
  const pickedId = game.pick?.sportEventParticipantId;
  return gameTeams(game).find((team) => team !== null && team.sportEventParticipantId === pickedId)?.participantId ?? null;
}

/**
 * One round of a playoff survivor pool (#785) as its own week: that round's games, its picks
 * counted, and the teams picked in the event's other rounds added to the teams already used, so
 * the week's screen reads it as it reads a regular-season week.
 */
export function roundWeek(gamePicks: GamePicksResponse, roundNumber: number): GamePicksResponse {
  const games = gamePicks.games.filter((game) => game.roundNumber === roundNumber);
  const otherRounds = gamePicks.games
    .filter((game) => game.roundNumber !== roundNumber)
    .flatMap((game) => pickedParticipantId(game) ?? []);
  const { survivor } = gamePicks;
  return {
    ...gamePicks,
    games,
    gameCount: games.length,
    pickedCount: games.filter((game) => game.pick !== null).length,
    survivor: survivor && {
      ...survivor,
      usedParticipantIds: survivor.usedParticipantIds && [...new Set([...survivor.usedParticipantIds, ...otherRounds])],
    },
  };
}
