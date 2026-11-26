/**
 * A bracket as its drawing reads it (#1753): the regions, each a small tree of rounds, and the
 * rounds where the regions meet in the middle, with every line's team and how the pick that put
 * it there stands. The left half of a desktop bracket holds the first, third… regions and the
 * right half, mirrored, the second, fourth…, so each half meets its neighbour in the semifinal
 * the bracket lists first. Everything is derived from the game-pick read; nothing is stored.
 */
import { MatchStatus, PickOutcome } from '@poolmaster/shared/domain';
import type { TeamLineMark } from '@/features/shared/ui';
import { buildBracketRounds, describeOpenSide, isFinalGame, type BracketGame, type BracketRound, type BracketTeam } from './bracket-layout';

/** One line of a game: the team the entry's picks put there, or an open line waiting for them. */
export interface BracketLine {
  /** Null while an earlier pick has still to fill it. */
  team: BracketTeam | null;
  /** How the pick that put the team here stands: right, wrong (or already out), not played yet. */
  mark: TeamLineMark;
  /** On a wrong line, the team that really won the place, once it is known. */
  actual: BracketTeam | null;
  /** Whether this is the entry's pick to win the game. */
  isPicked: boolean;
  /** An open line's words: whose winner fills it. */
  openLabel: string;
}

export interface BracketDrawnGame {
  game: BracketGame;
  /** Home first: the upper line on a neutral site. */
  lines: [BracketLine, BracketLine];
}

export interface BracketDrawnRound {
  roundNumber: number;
  label: string;
  games: BracketDrawnGame[];
}

/** A region, or the rounds where the regions meet. */
export interface BracketGroup {
  /** The region's name, or for the middle its first round's name ("Final Four"). */
  label: string;
  /** The region's name; null for the middle. */
  regionLabel: string | null;
  rounds: BracketDrawnRound[];
  /** A region's winner as the entry picked it: its last game's pick. Null for the middle. */
  winner: BracketLine | null;
}

export interface BracketChampion {
  team: BracketTeam;
  /** BUSTED: the team is out. */
  isOut: boolean;
}

export interface BracketDrawing {
  regions: BracketGroup[];
  /** The rounds where the regions meet; null in a bracket whose regions never meet. */
  middle: BracketGroup | null;
  /** The entry's pick to win it all; null until the final is picked. */
  champion: BracketChampion | null;
}

const MARKS: Partial<Record<PickOutcome, TeamLineMark>> = {
  [PickOutcome.CORRECT]: 'right',
  [PickOutcome.BUSTED]: 'wrong',
};

function markOf(pick: BracketGame['pick'] | undefined): TeamLineMark {
  return (pick?.outcome && MARKS[pick.outcome]) ?? 'none';
}

function pickedTeamId(game: BracketGame): string | null {
  return game.pick?.sportEventParticipantId ?? null;
}

/**
 * The line a team stands on in a game: marked by the entry's pick that sent it there, in the
 * round before. The bracket's own first round has no such pick, so its lines are plain.
 */
function drawLine(
  game: BracketGame,
  team: BracketTeam | null,
  realTeam: BracketTeam | null,
  feederPick: BracketGame['pick'] | undefined,
  openLabel: string,
): BracketLine {
  const mark = team ? markOf(feederPick) : 'none';
  return {
    team,
    mark,
    actual: mark === 'wrong' && realTeam && realTeam.sportEventParticipantId !== team?.sportEventParticipantId ? realTeam : null,
    isPicked: team !== null && pickedTeamId(game) === team.sportEventParticipantId,
    openLabel,
  };
}

/** A region's winner as the entry picked it: its last game's pick, marked by how that pick stands. */
function winnerLine(game: BracketGame): BracketLine | null {
  const id = pickedTeamId(game);
  const team = [game.predictedHome, game.predictedAway].find((side) => side?.sportEventParticipantId === id) ?? null;
  if (!team) {
    return null;
  }
  const realWinner = game.status === MatchStatus.COMPLETED && game.pick?.outcome === PickOutcome.BUSTED
    ? [game.home, game.away].find((side) => side && side.sportEventParticipantId !== id) ?? null
    : null;
  return { team, mark: markOf(game.pick), actual: realWinner, isPicked: false, openLabel: '' };
}

/** The entry's pick to win the final, and whether that team is out; null until it is picked. */
function drawChampion(rounds: readonly BracketRound[]): BracketChampion | null {
  // The final is the game the API marks as the final (#2006), never the last round's.
  const finals = rounds.flatMap((round) => round.regions.flatMap((region) => region.games)).filter(isFinalGame);
  const final = finals.length === 1 ? finals[0] : null;
  const winner = final ? winnerLine(final) : null;
  return winner?.team ? { team: winner.team, isOut: winner.mark === 'wrong' } : null;
}

/** The bracket's games drawn as regions meeting in the middle, with every line marked. */
export function drawBracket(games: readonly BracketGame[]): BracketDrawing {
  const rounds = buildBracketRounds(games);
  const feederPicks = new Map<string, NonNullable<BracketGame['pick']>>();
  const drawnRounds = rounds.map((round) => {
    const openLabel = describeOpenSide(round, rounds);
    const regions = round.regions.map((region) => ({
      regionLabel: region.regionLabel,
      games: region.games.map((game): BracketDrawnGame => ({
        game,
        lines: [
          drawLine(game, game.predictedHome, game.home, game.predictedHome ? feederPicks.get(`${round.roundNumber}:${game.predictedHome.sportEventParticipantId}`) : undefined, openLabel),
          drawLine(game, game.predictedAway, game.away, game.predictedAway ? feederPicks.get(`${round.roundNumber}:${game.predictedAway.sportEventParticipantId}`) : undefined, openLabel),
        ],
      })),
    }));
    // This round's picks mark the lines their teams stand on in the next.
    for (const game of round.regions.flatMap((region) => region.games)) {
      if (game.pick?.sportEventParticipantId) {
        feederPicks.set(`${round.roundNumber + 1}:${game.pick.sportEventParticipantId}`, game.pick);
      }
    }
    return { round, regions };
  });

  const regionLabels = [...new Set(games.flatMap((game) => (game.regionLabel === null ? [] : [game.regionLabel])))];
  // The regions in the order the bracket lists them: by their first game.
  regionLabels.sort((left, right) => firstMatch(games, left) - firstMatch(games, right));
  const regions = regionLabels.map((regionLabel): BracketGroup => {
    const regionRounds = drawnRounds.flatMap(({ round, regions: drawn }) => {
      const region = drawn.find((candidate) => candidate.regionLabel === regionLabel);
      return region ? [{ roundNumber: round.roundNumber, label: round.label, games: region.games }] : [];
    });
    // A region's own last round names its winner; the bracket's final is found by its flag (splitMiddle).
    const lastGame = regionRounds.at(-1)?.games;
    return {
      label: regionLabel,
      regionLabel,
      rounds: regionRounds,
      winner: lastGame?.length === 1 ? winnerLine(lastGame[0].game) : null,
    };
  });
  const middleRounds = drawnRounds.flatMap(({ round, regions: drawn }) => {
    const middle = drawn.find((candidate) => candidate.regionLabel === null);
    return middle ? [{ roundNumber: round.roundNumber, label: round.label, games: middle.games }] : [];
  });
  return {
    regions,
    middle: middleRounds.length > 0 ? { label: middleRounds[0].label, regionLabel: null, rounds: middleRounds, winner: null } : null,
    champion: drawChampion(rounds),
  };
}

function firstMatch(games: readonly BracketGame[], regionLabel: string): number {
  return Math.min(...games.filter((game) => game.regionLabel === regionLabel).map((game) => game.matchNumber));
}

/** The regions on each half of a desktop bracket: the first, third… on the left, the rest mirrored on the right. */
export function bracketHalves(drawing: BracketDrawing): { left: BracketGroup[]; right: BracketGroup[] } {
  return {
    left: drawing.regions.filter((_, index) => index % 2 === 0),
    right: drawing.regions.filter((_, index) => index % 2 === 1),
  };
}

/** How many rounds a phone shows side by side. */
export const PHONE_ROUNDS_SHOWN = 2;

/**
 * The first round a phone shows of a group: the round being played now (the first with a game
 * not finished), or the last pair once every round is done.
 */
export function openingRoundIndex(group: Pick<BracketGroup, 'rounds'>): number {
  const current = group.rounds.findIndex((round) => round.games.some(({ game }) => game.status !== MatchStatus.COMPLETED && game.status !== MatchStatus.CANCELLED));
  const lastStart = Math.max(group.rounds.length - PHONE_ROUNDS_SHOWN, 0);
  return Math.min(current < 0 ? lastStart : current, lastStart);
}

/**
 * The middle of a bracket laid out as on paper: the final in the centre, and each round before it
 * split in two, its first games on the left and the rest on the right, so the Final Four's first
 * semifinal sits left and its second right. A bracket of one game has only the centre.
 */
export function splitMiddle(middle: Pick<BracketGroup, 'rounds'>): {
  final: BracketDrawnGame | null;
  finalRound: BracketDrawnRound | null;
  left: BracketDrawnRound[];
  right: BracketDrawnRound[];
} {
  // The final is the game the API marks as the final (#2006), never the last round's.
  const finalRound = middle.rounds.find((round) => round.games.length === 1 && round.games.every(({ game }) => isFinalGame(game))) ?? null;
  const final = finalRound?.games.find(({ game }) => isFinalGame(game)) ?? null;
  const before = middle.rounds.filter((round) => round !== finalRound);
  const half = (round: BracketDrawnRound, side: 'left' | 'right'): BracketDrawnRound => {
    const cut = Math.ceil(round.games.length / 2);
    return { ...round, games: side === 'left' ? round.games.slice(0, cut) : round.games.slice(cut) };
  };
  return {
    final,
    finalRound,
    left: before.map((round) => half(round, 'left')),
    right: before.map((round) => half(round, 'right')).filter((round) => round.games.length > 0),
  };
}
