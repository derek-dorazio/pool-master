/**
 * A whole NCAA men's bracket as the vendor's `/ncaab/v1/bracket` answers it, written to the
 * vendor's document: four regions of eight round of 64 games, two First Four games (East 11 and
 * South 16), whose round of 64 side waits on the winner, and the later rounds' games with no team
 * yet. The vendor lists the games in no bracket order, so this lists each region's round of 64
 * bottom to top and the regions by name, not by `region_id`.
 *
 * Scaffolding only: no assertions here.
 */

/** The regions, by the vendor's `region_id`: the first two meet in a national semifinal. */
export const NCAA_REGIONS = [
  { id: 1, label: 'East' },
  { id: 2, label: 'West' },
  { id: 3, label: 'South' },
  { id: 4, label: 'Midwest' },
] as const;

/** The First Four: the region and seed each fills, and its two teams' ids. */
export const NCAA_FIRST_FOUR = [
  { region: 'East', seed: 11, teams: [111, 151] },
  { region: 'South', seed: 16, teams: [316, 356] },
] as const;

/** A team's vendor id: the region's id times 100 plus its seed. */
export const ncaaTeamId = (regionId: number, seed: number): number => regionId * 100 + seed;

const KICKOFF = Date.parse('2026-03-19T16:00:00.000Z');
const HOUR = 60 * 60 * 1000;

interface Side { id: number | null; name: string; full_name: string | null; seed: string; score: number | null }

const team = (id: number, seed: number): Side => ({ id, name: `Team ${id}`, full_name: `School ${id} Team ${id}`, seed: String(seed), score: null });
const undecided = (seed: number): Side => ({ id: null, name: 'TBD', full_name: null, seed: String(seed), score: null });

/** The bracket's games, each as the vendor's JSON; `firstFourFinal` plays the First Four, its home team winning into the round of 64. */
export function ncaaFullBracket(options: { firstFourFinal?: boolean } = {}): Array<Record<string, unknown>> {
  let gameId = 401_900_000;
  const game = (round: number, region: (typeof NCAA_REGIONS)[number] | null, home: Side | null, away: Side | null, hoursAfter: number, state = 'scheduled') => {
    gameId += 1;
    return {
      game_id: gameId,
      season: 2025,
      round,
      region_id: region?.id ?? null,
      region_label: region?.label ?? null,
      bracket_location: null,
      date: new Date(KICKOFF + hoursAfter * HOUR).toISOString(),
      status: state === 'final' ? 'post' : 'pre',
      status_state: state,
      home_team: home,
      away_team: away,
    };
  };
  const regionOf = (label: string) => NCAA_REGIONS.find((region) => region.label === label) ?? null;
  const firstFour = NCAA_FIRST_FOUR.map(({ region, seed, teams: [home, away] }) =>
    game(1, regionOf(region), { ...team(home, seed), score: options.firstFourFinal ? 70 : null }, { ...team(away, seed), score: options.firstFourFinal ? 60 : null }, -48, options.firstFourFinal ? 'final' : 'scheduled'));
  const playInOf = (label: string, seed: number) => NCAA_FIRST_FOUR.find((entry) => entry.region === label && entry.seed === seed);
  const sideOf = (region: (typeof NCAA_REGIONS)[number], seed: number): Side => {
    const playIn = playInOf(region.label, seed);
    if (!playIn) return team(ncaaTeamId(region.id, seed), seed);
    return options.firstFourFinal ? team(playIn.teams[0], seed) : undecided(seed);
  };
  const byName = [...NCAA_REGIONS].sort((left, right) => left.label.localeCompare(right.label));
  const roundOf64 = byName.flatMap((region, regionIndex) => [2, 7, 3, 6, 4, 5, 8, 1].map((better, index) =>
    game(2, region, sideOf(region, better), sideOf(region, 17 - better), regionIndex * 4 + index)));
  const later = [3, 4, 5, 6, 7].flatMap((round) => [game(round, round <= 5 ? NCAA_REGIONS[0] : null, null, null, round * 48)]);
  return [...firstFour, ...roundOf64, ...later];
}
