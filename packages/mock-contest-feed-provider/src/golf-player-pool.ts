import type {
  ContestantDeltaRecord,
  ContestantRecord,
} from './contracts';

interface GolfPoolPlayer {
  readonly contestantId: string;
  readonly name: string;
  readonly countryCode: string;
  readonly teamName: string;
  readonly ranking: number;
}

const GOLF_PLAYER_POOL: readonly GolfPoolPlayer[] = [
  { contestantId: 'golfer-01', name: 'Scottie Scheffler', countryCode: 'US', teamName: 'USA', ranking: 1 },
  { contestantId: 'golfer-02', name: 'Rory McIlroy', countryCode: 'GB', teamName: 'Northern Ireland', ranking: 2 },
  { contestantId: 'golfer-03', name: 'Xander Schauffele', countryCode: 'US', teamName: 'USA', ranking: 3 },
  { contestantId: 'golfer-04', name: 'Collin Morikawa', countryCode: 'US', teamName: 'USA', ranking: 4 },
  { contestantId: 'golfer-05', name: 'Ludvig Aberg', countryCode: 'SE', teamName: 'Sweden', ranking: 5 },
  { contestantId: 'golfer-06', name: 'Viktor Hovland', countryCode: 'NO', teamName: 'Norway', ranking: 6 },
  { contestantId: 'golfer-07', name: 'Hideki Matsuyama', countryCode: 'JP', teamName: 'Japan', ranking: 7 },
  { contestantId: 'golfer-08', name: 'Justin Thomas', countryCode: 'US', teamName: 'USA', ranking: 8 },
  { contestantId: 'golfer-09', name: 'Tommy Fleetwood', countryCode: 'GB', teamName: 'England', ranking: 9 },
  { contestantId: 'golfer-10', name: 'Bryson DeChambeau', countryCode: 'US', teamName: 'USA', ranking: 10 },
  { contestantId: 'golfer-11', name: 'Seamus Power', countryCode: 'IE', teamName: 'Ireland', ranking: 11 },
  { contestantId: 'golfer-12', name: 'Min Woo Lee', countryCode: 'AU', teamName: 'Australia', ranking: 12 },
  { contestantId: 'golfer-13', name: 'Robert MacIntyre', countryCode: 'GB', teamName: 'Scotland', ranking: 13 },
  { contestantId: 'golfer-14', name: 'Patrick Cantlay', countryCode: 'US', teamName: 'USA', ranking: 14 },
  { contestantId: 'golfer-15', name: 'Max Homa', countryCode: 'US', teamName: 'USA', ranking: 15 },
  { contestantId: 'golfer-16', name: 'Wyndham Clark', countryCode: 'US', teamName: 'USA', ranking: 16 },
  { contestantId: 'golfer-17', name: 'Jordan Spieth', countryCode: 'US', teamName: 'USA', ranking: 17 },
  { contestantId: 'golfer-18', name: 'Sam Burns', countryCode: 'US', teamName: 'USA', ranking: 18 },
  { contestantId: 'golfer-19', name: 'Tony Finau', countryCode: 'US', teamName: 'USA', ranking: 19 },
  { contestantId: 'golfer-20', name: 'Sahith Theegala', countryCode: 'US', teamName: 'USA', ranking: 20 },
  { contestantId: 'golfer-21', name: 'Russell Henley', countryCode: 'US', teamName: 'USA', ranking: 21 },
  { contestantId: 'golfer-22', name: 'Sungjae Im', countryCode: 'KR', teamName: 'South Korea', ranking: 22 },
  { contestantId: 'golfer-23', name: 'Shane Lowry', countryCode: 'IE', teamName: 'Ireland', ranking: 23 },
  { contestantId: 'golfer-24', name: 'Matt Fitzpatrick', countryCode: 'GB', teamName: 'England', ranking: 24 },
  { contestantId: 'golfer-25', name: 'Jason Day', countryCode: 'AU', teamName: 'Australia', ranking: 25 },
  { contestantId: 'golfer-26', name: 'Cameron Young', countryCode: 'US', teamName: 'USA', ranking: 26 },
  { contestantId: 'golfer-27', name: 'Keegan Bradley', countryCode: 'US', teamName: 'USA', ranking: 27 },
  { contestantId: 'golfer-28', name: 'Akshay Bhatia', countryCode: 'US', teamName: 'USA', ranking: 28 },
  { contestantId: 'golfer-29', name: 'Tom Kim', countryCode: 'KR', teamName: 'South Korea', ranking: 29 },
  { contestantId: 'golfer-30', name: 'Adam Scott', countryCode: 'AU', teamName: 'Australia', ranking: 30 },
  { contestantId: 'golfer-31', name: 'Brian Harman', countryCode: 'US', teamName: 'USA', ranking: 31 },
  { contestantId: 'golfer-32', name: 'Justin Rose', countryCode: 'GB', teamName: 'England', ranking: 32 },
  { contestantId: 'golfer-33', name: 'Cameron Smith', countryCode: 'AU', teamName: 'Australia', ranking: 33 },
  { contestantId: 'golfer-34', name: 'Tyrrell Hatton', countryCode: 'GB', teamName: 'England', ranking: 34 },
  { contestantId: 'golfer-35', name: 'Nick Dunlap', countryCode: 'US', teamName: 'USA', ranking: 35 },
  { contestantId: 'golfer-36', name: 'Will Zalatoris', countryCode: 'US', teamName: 'USA', ranking: 36 },
  { contestantId: 'golfer-37', name: 'Corey Conners', countryCode: 'CA', teamName: 'Canada', ranking: 37 },
  { contestantId: 'golfer-38', name: 'Rickie Fowler', countryCode: 'US', teamName: 'USA', ranking: 38 },
  { contestantId: 'golfer-39', name: 'Harris English', countryCode: 'US', teamName: 'USA', ranking: 39 },
  { contestantId: 'golfer-40', name: 'Billy Horschel', countryCode: 'US', teamName: 'USA', ranking: 40 },
  { contestantId: 'golfer-41', name: 'Denny McCarthy', countryCode: 'US', teamName: 'USA', ranking: 41 },
  { contestantId: 'golfer-42', name: 'Chris Kirk', countryCode: 'US', teamName: 'USA', ranking: 42 },
  { contestantId: 'golfer-43', name: 'Byeong Hun An', countryCode: 'KR', teamName: 'South Korea', ranking: 43 },
  { contestantId: 'golfer-44', name: 'Davis Thompson', countryCode: 'US', teamName: 'USA', ranking: 44 },
  { contestantId: 'golfer-45', name: 'Si Woo Kim', countryCode: 'KR', teamName: 'South Korea', ranking: 45 },
  { contestantId: 'golfer-46', name: 'Eric Cole', countryCode: 'US', teamName: 'USA', ranking: 46 },
  { contestantId: 'golfer-47', name: 'J.T. Poston', countryCode: 'US', teamName: 'USA', ranking: 47 },
  { contestantId: 'golfer-48', name: 'Taylor Pendrith', countryCode: 'CA', teamName: 'Canada', ranking: 48 },
  { contestantId: 'golfer-49', name: 'Aaron Rai', countryCode: 'GB', teamName: 'England', ranking: 49 },
  { contestantId: 'golfer-50', name: 'Adam Hadwin', countryCode: 'CA', teamName: 'Canada', ranking: 50 },
  { contestantId: 'golfer-51', name: 'Maverick McNealy', countryCode: 'US', teamName: 'USA', ranking: 51 },
  { contestantId: 'golfer-52', name: 'Thomas Detry', countryCode: 'BE', teamName: 'Belgium', ranking: 52 },
  { contestantId: 'golfer-53', name: 'Austin Eckroat', countryCode: 'US', teamName: 'USA', ranking: 53 },
  { contestantId: 'golfer-54', name: 'Cam Davis', countryCode: 'AU', teamName: 'Australia', ranking: 54 },
  { contestantId: 'golfer-55', name: 'Emiliano Grillo', countryCode: 'AR', teamName: 'Argentina', ranking: 55 },
  { contestantId: 'golfer-56', name: 'Lucas Glover', countryCode: 'US', teamName: 'USA', ranking: 56 },
  { contestantId: 'golfer-57', name: 'Kurt Kitayama', countryCode: 'US', teamName: 'USA', ranking: 57 },
  { contestantId: 'golfer-58', name: 'Nick Taylor', countryCode: 'CA', teamName: 'Canada', ranking: 58 },
  { contestantId: 'golfer-59', name: 'Mackenzie Hughes', countryCode: 'CA', teamName: 'Canada', ranking: 59 },
  { contestantId: 'golfer-60', name: 'Adam Svensson', countryCode: 'CA', teamName: 'Canada', ranking: 60 },
  { contestantId: 'golfer-61', name: 'Sepp Straka', countryCode: 'AT', teamName: 'Austria', ranking: 61 },
  { contestantId: 'golfer-62', name: 'Stephan Jaeger', countryCode: 'DE', teamName: 'Germany', ranking: 62 },
  { contestantId: 'golfer-63', name: 'Nicolai Hojgaard', countryCode: 'DK', teamName: 'Denmark', ranking: 63 },
  { contestantId: 'golfer-64', name: 'Rasmus Hojgaard', countryCode: 'DK', teamName: 'Denmark', ranking: 64 },
  { contestantId: 'golfer-65', name: 'Adrian Meronk', countryCode: 'PL', teamName: 'Poland', ranking: 65 },
  { contestantId: 'golfer-66', name: 'Alex Noren', countryCode: 'SE', teamName: 'Sweden', ranking: 66 },
  { contestantId: 'golfer-67', name: 'Christiaan Bezuidenhout', countryCode: 'ZA', teamName: 'South Africa', ranking: 67 },
  { contestantId: 'golfer-68', name: 'Victor Perez', countryCode: 'FR', teamName: 'France', ranking: 68 },
  { contestantId: 'golfer-69', name: 'Matthieu Pavon', countryCode: 'FR', teamName: 'France', ranking: 69 },
  { contestantId: 'golfer-70', name: 'Davis Riley', countryCode: 'US', teamName: 'USA', ranking: 70 },
  { contestantId: 'golfer-71', name: 'Sam Stevens', countryCode: 'US', teamName: 'USA', ranking: 71 },
  { contestantId: 'golfer-72', name: 'Brendon Todd', countryCode: 'US', teamName: 'USA', ranking: 72 },
  { contestantId: 'golfer-73', name: 'Andrew Novak', countryCode: 'US', teamName: 'USA', ranking: 73 },
  { contestantId: 'golfer-74', name: 'Matt Kuchar', countryCode: 'US', teamName: 'USA', ranking: 74 },
  { contestantId: 'golfer-75', name: 'Webb Simpson', countryCode: 'US', teamName: 'USA', ranking: 75 },
  { contestantId: 'golfer-76', name: 'Taylor Moore', countryCode: 'US', teamName: 'USA', ranking: 76 },
  { contestantId: 'golfer-77', name: 'Beau Hossler', countryCode: 'US', teamName: 'USA', ranking: 77 },
  { contestantId: 'golfer-78', name: 'Jake Knapp', countryCode: 'US', teamName: 'USA', ranking: 78 },
  { contestantId: 'golfer-79', name: 'Michael Kim', countryCode: 'US', teamName: 'USA', ranking: 79 },
  { contestantId: 'golfer-80', name: 'Doug Ghim', countryCode: 'US', teamName: 'USA', ranking: 80 },
] as const;

function hashUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function roundOdds(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildMockGolfFieldContestants(): readonly ContestantRecord[] {
  return GOLF_PLAYER_POOL.map((player) => ({
    contestantId: player.contestantId,
    name: player.name,
    teamName: player.teamName,
    countryCode: player.countryCode,
    seed: player.ranking,
    ranking: player.ranking,
    participantStatus: 'active',
  }));
}

export function buildMockGolfRankingContestants(): readonly ContestantDeltaRecord[] {
  return GOLF_PLAYER_POOL.map((player) => ({
    contestantId: player.contestantId,
    ranking: player.ranking,
  }));
}

export function buildMockGolfOddsContestants(eventId: string): readonly ContestantDeltaRecord[] {
  const ordered = [...GOLF_PLAYER_POOL]
    .map((player) => ({
      ...player,
      eventRankScore:
        player.ranking
        + ((hashUnit(`${eventId}:${player.contestantId}:form`) - 0.5) * 18)
        + ((hashUnit(`${eventId}:${player.contestantId}:course`) - 0.5) * 12)
        + ((hashUnit(`${eventId}:${player.countryCode}:travel`) - 0.5) * 4),
    }))
    .sort((left, right) => left.eventRankScore - right.eventRankScore);

  return ordered.map((player, index) => ({
    contestantId: player.contestantId,
    odds: roundOdds(
      6
      + (Math.pow(index + 1, 1.23) * 1.9)
      + (hashUnit(`${eventId}:${player.contestantId}:price`) * 2.5),
    ),
  }));
}
