import type { GamePicksResponse } from '@/lib/api';

/**
 * A whole 64-team, four-region bracket in the generated contract's shapes (#1753), for the
 * bracket view's stories and tests: the regions meet in a Final Four and a final. Results are
 * played through `playedRounds`; the entry's picks follow chalk (the better seed) except where
 * `upsets` names, by round, the team it picked instead. The real games follow chalk except where
 * `realUpsets` names, by round, the team that really won. Names are made up.
 */

type Game = GamePicksResponse['games'][number];
type Team = NonNullable<Game['home']>;

const REGIONS = ['South', 'East', 'West', 'Midwest'] as const;
/** A region's first-round lines, top to bottom, by seed. */
const SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
const NAMES: Record<(typeof REGIONS)[number], string[]> = {
  South: ['Auburn', 'Alabama St.', 'Louisville', 'Creighton', 'Michigan', 'UC San Diego', 'Texas A&M', 'Yale', 'Ole Miss', 'North Carolina', 'Iowa St.', 'Lipscomb', 'Marquette', 'New Mexico', 'Michigan St.', 'Bryant'],
  East: ['Duke', 'Mt. St. Mary\'s', 'Mississippi St.', 'Baylor', 'Oregon', 'Liberty', 'Arizona', 'Akron', 'BYU', 'VCU', 'Wisconsin', 'Montana', 'Saint Mary\'s', 'Vanderbilt', 'Alabama', 'Robert Morris'],
  West: ['Florida', 'Norfolk St.', 'UConn', 'Oklahoma', 'Memphis', 'Colorado St.', 'Maryland', 'Grand Canyon', 'Missouri', 'Drake', 'Texas Tech', 'UNC Wilmington', 'Kansas', 'Arkansas', 'St. John\'s', 'Omaha'],
  Midwest: ['Houston', 'SIU-E', 'Gonzaga', 'Georgia', 'Clemson', 'McNeese', 'Purdue', 'High Point', 'Illinois', 'Xavier', 'Kentucky', 'Troy', 'UCLA', 'Utah St.', 'Tennessee', 'Wofford'],
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Every team of the bracket, by name. */
export const TOURNAMENT_TEAMS: ReadonlyMap<string, Team> = new Map(REGIONS.flatMap((region) => NAMES[region].map((name, index) => {
  const seedNumber = SEED_ORDER[index];
  return [name, { sportEventParticipantId: `sep-${slug(name)}`, participantId: `participant-${slug(name)}`, name, seedNumber }] as const;
})));

function teamNamed(name: string): Team {
  const team = TOURNAMENT_TEAMS.get(name);
  if (!team) throw new Error(`No team named ${name}`);
  return team;
}

/** The better seed of two, the first on a tie. */
function chalk(home: Team, away: Team): Team {
  return (away.seedNumber ?? 99) < (home.seedNumber ?? 99) ? away : home;
}

export function tournamentGames({
  playedRounds,
  realUpsets = [],
  upsets = [],
}: {
  /** How many rounds have been played: 3 is through the Sweet 16. */
  playedRounds: number;
  /** The teams that really beat a better seed, by round number and name. */
  realUpsets?: ReadonlyArray<readonly [number, string]>;
  /** The teams the entry picked over a better seed, by round number and name. */
  upsets?: ReadonlyArray<readonly [number, string]>;
}): Game[] {
  const games: Game[] = [];
  const realOut = new Set<string>();
  let realSides: Array<Team | null> = REGIONS.flatMap((region) => NAMES[region].map(teamNamed));
  let pickedSides: Array<Team | null> = [...realSides];
  let matchNumber = 0;
  for (let roundNumber = 1; realSides.length > 1; roundNumber += 1) {
    const nextReal: Array<Team | null> = [];
    const nextPicked: Array<Team | null> = [];
    const regionSize = realSides.length / 4;
    for (let index = 0; index < realSides.length; index += 2) {
      matchNumber += 1;
      const [home, away] = [realSides[index], realSides[index + 1]];
      const [predictedHome, predictedAway] = [pickedSides[index], pickedSides[index + 1]];
      const played = roundNumber <= playedRounds;
      const upsetIn = (list: ReadonlyArray<readonly [number, string]>, team: Team) => list.some(([round, name]) => round === roundNumber && name === team.name);
      const winner = played && home && away
        ? (upsetIn(realUpsets, home) ? home : upsetIn(realUpsets, away) ? away : chalk(home, away))
        : null;
      if (winner && home && away) realOut.add((winner === home ? away : home).sportEventParticipantId);
      const picked = predictedHome && predictedAway
        ? (upsetIn(upsets, predictedHome) ? predictedHome : upsetIn(upsets, predictedAway) ? predictedAway : chalk(predictedHome, predictedAway))
        : null;
      const outcome = picked === null
        ? null
        : winner ? (winner.sportEventParticipantId === picked.sportEventParticipantId ? 'CORRECT' : 'BUSTED')
          : realOut.has(picked.sportEventParticipantId) ? 'BUSTED' : 'PENDING';
      games.push({
        sportEventRoundMatchId: `match-${matchNumber}`,
        matchNumber,
        roundNumber,
        kickoff: '2026-03-20T16:00:00.000Z',
        status: played ? 'COMPLETED' : 'SCHEDULED',
        isNeutralSite: true,
        regionLabel: regionSize >= 2 ? REGIONS[Math.floor(index / regionSize)] : null,
        homeSpread: null,
        home: roundNumber === 1 || roundNumber <= playedRounds + 1 ? home : null,
        away: roundNumber === 1 || roundNumber <= playedRounds + 1 ? away : null,
        predictedHome,
        predictedAway,
        locked: true,
        revealed: true,
        pick: picked ? {
          predictedResult: 'TEAM',
          sportEventParticipantId: picked.sportEventParticipantId,
          confidence: null,
          pickedAt: '2026-03-19T12:00:00.000Z',
          outcome,
          points: outcome === 'CORRECT' ? 2 ** (roundNumber - 1) : outcome === 'BUSTED' ? 0 : null,
          survivorOutcome: null,
        } : null,
      });
      nextReal.push(winner);
      nextPicked.push(picked);
    }
    realSides = nextReal;
    pickedSides = nextPicked;
  }
  return games;
}

/**
 * The mockup's bracket, after the Sweet 16: UC San Diego beat the Michigan the entry picked, so
 * its later pick of Michigan over Texas A&M is out too; Kentucky beat Houston in the Sweet 16, as
 * the entry picked. Auburn is its champion, still in.
 */
export function midTournamentGames(): Game[] {
  return tournamentGames({
    playedRounds: 3,
    realUpsets: [[1, 'UC San Diego'], [1, 'Akron'], [2, 'Akron'], [1, 'Norfolk St.'], [3, 'Kentucky']],
    upsets: [[2, 'Michigan'], [1, 'Akron'], [3, 'Kentucky'], [4, 'Kentucky']],
  });
}
