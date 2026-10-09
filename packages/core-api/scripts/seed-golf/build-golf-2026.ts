/**
 * Builds golf-2026.json, the manual-testing seed for the 2026 PGA TOUR and LPGA Tour: every
 * tournament with a field, each golfer's ranking and odds, and four rounds of scores with a
 * cut, withdrawals and a final order.
 *
 * Schedules and player lists are the mock provider's tour files, which came from public
 * sources (see that folder's SOURCES.md). Winners are public results where a search found
 * one (WINNERS below); every other score, field and price is made up from a fixed random seed,
 * so a rebuild gives the same file. Nothing here is authoritative: it only has to be a
 * complete, believable set.
 *
 * Usage: npm run seed:golf:build
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GolfSeedEvent, GolfSeedFile, GolfSeedGolfer, GolfSeedPlayer, GolfSeedTour } from './seed-golf-data';

const here = dirname(fileURLToPath(import.meta.url));
const toursDir = join(here, '../../../mock-contest-feed-provider/contest-feed-scenarios/tours');
const outputPath = join(here, 'golf-2026.json');

/** 2026 winners found in public results (search summaries, October 2026). Team events have none. */
const WINNERS: Record<string, string> = {
  'pga-tour-2026-sony-open-in-hawaii': 'Chris Gotterup',
  'pga-tour-2026-the-genesis-invitational': 'Jacob Bridgeman',
  'pga-tour-2026-cognizant-classic-in-the-palm-beaches': 'Nico Echavarria',
  'pga-tour-2026-arnold-palmer-invitational': 'Akshay Bhatia',
  'pga-tour-2026-puerto-rico-open': 'Ricky Castillo',
  'pga-tour-2026-the-players-championship': 'Cameron Young',
  'pga-tour-2026-valspar-championship': 'Matt Fitzpatrick',
  'pga-tour-2026-texas-children-s-houston-open': 'Gary Woodland',
  'pga-tour-2026-valero-texas-open': 'J.J. Spaun',
  'pga-tour-2026-masters-tournament': 'Rory McIlroy',
  'pga-tour-2026-rbc-heritage': 'Matt Fitzpatrick',
  'pga-tour-2026-cadillac-championship': 'Cameron Young',
  'pga-tour-2026-truist-championship': 'Kristoffer Reitan',
  'pga-tour-2026-oneflight-myrtle-beach-classic': 'Brandt Snedeker',
  'pga-tour-2026-pga-championship': 'Aaron Rai',
  'pga-tour-2026-the-memorial-tournament-presented-by-workday': 'J.T. Poston',
  'pga-tour-2026-u-s-open': 'Wyndham Clark',
  'pga-tour-2026-travelers-championship': 'Viktor Hovland',
  'pga-tour-2026-the-open-championship': 'Ryan Fox',
  'pga-tour-2026-tour-championship': 'Scottie Scheffler',
  'lpga-tour-2026-hilton-grand-vacations-tournament-of-champions': 'Nelly Korda',
  'lpga-tour-2026-honda-lpga-thailand': 'Jeeno Thitikul',
  'lpga-tour-2026-hsbc-women-s-world-championship': 'Hannah Green',
  'lpga-tour-2026-blue-bay-lpga': 'Mi Hyang Lee',
  'lpga-tour-2026-fortinet-founders-cup': 'Hyo Joo Kim',
  'lpga-tour-2026-ford-championship-presented-by-wild-horse-pass': 'Hyo Joo Kim',
  'lpga-tour-2026-aramco-championship': 'Lauren Coughlin',
  'lpga-tour-2026-jm-eagle-la-championship': 'Hannah Green',
  'lpga-tour-2026-the-chevron-championship': 'Nelly Korda',
  'lpga-tour-2026-mexico-riviera-maya-open-at-mayakoba': 'Nelly Korda',
  'lpga-tour-2026-mizuho-americas-open': 'Jeeno Thitikul',
  'lpga-tour-2026-kroger-queen-city-championship-presented-by-p-g': 'Lottie Woad',
  'lpga-tour-2026-shoprite-lpga-classic': 'Celine Boutier',
  'lpga-tour-2026-u-s-women-s-open': 'Nelly Korda',
  'lpga-tour-2026-meijer-lpga-classic-for-simply-give': 'Miyu Yamashita',
  'lpga-tour-2026-kpmg-women-s-pga-championship': 'Hae Ran Ryu',
  'lpga-tour-2026-the-amundi-evian-championship': 'Hae Ran Ryu',
  'lpga-tour-2026-isps-handa-women-s-scottish-open': 'Jenny Shin',
  'lpga-tour-2026-aig-women-s-open': 'Shiho Kuwaki',
};

/** Public winners missing from the tour's ranked list, added at the back of it. */
const EXTRA_PLAYERS: Record<string, Array<{ name: string; countryCode: string }>> = {
  'PGA TOUR': [{ name: 'Brandt Snedeker', countryCode: 'US' }],
  'LPGA Tour': [{ name: 'Shiho Kuwaki', countryCode: 'JP' }],
};

const CUT_ROUND = 2;
const CUT_SIZE = 65;
const WITHDRAWALS_PER_EVENT = 2;
const MAX_ODDS = 1000;

interface TourFile {
  tour: string;
  tourId: string;
  events: Array<{
    eventId: string;
    name: string;
    startDate: string;
    endDate: string;
    rounds: number;
    venue: { name?: string; city?: string; region?: string; countryCode?: string };
    purse?: number | null;
  }>;
}

interface PlayersFile {
  players: Array<{ playerId: string; name: string; countryCode: string; ranking: number }>;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(toursDir, name), 'utf8'));
}

/** mulberry32 over a string hash: the same name always gives the same sequence. */
function seededRandom(seed: string): () => number {
  let state = 0;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 2654435761) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function slug(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fieldSize(event: TourFile['events'][number], tourPlayers: number, random: () => number): number {
  // Signature events and majors run smaller fields; everything else a full one.
  const sizes = (event.purse ?? 0) >= 20_000_000 ? [72, 78, 90] : [120, 132, 144];
  return Math.min(tourPlayers, sizes[Math.floor(random() * sizes.length)]);
}

function buildEvent(tour: GolfSeedTour, event: TourFile['events'][number]): GolfSeedEvent {
  const random = seededRandom(event.eventId);
  const roundsPar = tour.name === 'PGA TOUR' ? [70, 71, 72][Math.floor(random() * 3)] : 72;
  const winnerName = WINNERS[event.eventId];
  const winner = winnerName ? tour.players.find((player) => player.name === winnerName) : undefined;
  if (winnerName && !winner) throw new Error(`${winnerName} (winner of ${event.eventId}) is not a ${tour.name} player`);

  // Better-ranked golfers are more likely to play; the winner always does.
  const chosen = tour.players
    .map((player) => ({ player, draw: player.ranking + random() * 90 }))
    .sort((left, right) => left.draw - right.draw)
    .slice(0, fieldSize(event, tour.players.length, random))
    .map(({ player }) => player);
  if (winner && !chosen.includes(winner)) chosen[chosen.length - 1] = winner;

  // Form this week: the ranking plus noise. Odds come from it; scores from it plus more noise.
  const golfers = chosen.map((player) => {
    const form = -2.2 + Math.log(player.ranking) * 0.55 + normal(random) * 0.6;
    return { player, form, rounds: [] as number[], finish: undefined as GolfSeedGolfer['finish'], withdrawnThru: undefined as number | undefined };
  });
  const weights = golfers.map((golfer) => Math.exp(-golfer.form * 1.6));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const playRound = (golfer: (typeof golfers)[number]) => {
    golfer.rounds.push(roundsPar + Math.round(golfer.form + normal(random) * 2.8));
  };
  const total = (golfer: (typeof golfers)[number]) => golfer.rounds.reduce((sum, strokes) => sum + strokes, 0);

  const withdrawers = new Set<number>();
  while (withdrawers.size < WITHDRAWALS_PER_EVENT) {
    const index = Math.floor(random() * golfers.length);
    if (golfers[index].player !== winner) withdrawers.add(index);
  }
  // Withdrawals come before the cut, so every event shows some.
  const withdrawalRound = new Map([...withdrawers].map((index) => [index, 1 + Math.floor(random() * Math.min(CUT_ROUND, event.rounds))]));

  for (let round = 1; round <= event.rounds; round += 1) {
    golfers.forEach((golfer, index) => {
      if (golfer.finish) return;
      if (withdrawalRound.get(index) === round) {
        const thru = 3 + Math.floor(random() * 13);
        golfer.rounds.push(Math.round((roundsPar * thru) / 18 + golfer.form * (thru / 18) + normal(random)));
        golfer.finish = 'WD';
        golfer.withdrawnThru = thru;
        return;
      }
      playRound(golfer);
    });
    if (round === CUT_ROUND && event.rounds > CUT_ROUND) {
      const contenders = golfers.filter((golfer) => !golfer.finish).sort((left, right) => total(left) - total(right));
      if (contenders.length > CUT_SIZE + 10) {
        const cutLine = total(contenders[CUT_SIZE - 1]);
        contenders.filter((golfer) => total(golfer) > cutLine && golfer.player !== winner).forEach((golfer) => {
          golfer.finish = 'MC';
        });
      }
    }
  }

  // The public winner wins outright: they swap cards with the leader if they are not ahead,
  // and take a shot off Sunday if anyone is still level with them.
  if (winner) {
    const champion = golfers.find((golfer) => golfer.player === winner)!;
    const others = golfers.filter((golfer) => !golfer.finish && golfer !== champion);
    const leader = others.reduce((best, golfer) => (total(golfer) < total(best) ? golfer : best));
    if (total(leader) < total(champion)) [champion.rounds, leader.rounds] = [leader.rounds, champion.rounds];
    if (others.some((golfer) => total(golfer) <= total(champion))) champion.rounds[champion.rounds.length - 1] -= 1;
  }

  return {
    key: event.eventId,
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
    venue: event.venue.name ?? null,
    location: [event.venue.city, event.venue.region, event.venue.countryCode].filter(Boolean).join(', ') || null,
    rounds: event.rounds,
    roundsPar,
    winner: winner ? 'public' : 'generated',
    field: golfers
      .map((golfer, index) => ({
        player: golfer.player.key,
        ranking: golfer.player.ranking,
        oddsToWin: Math.min(MAX_ODDS, Math.max(2, Math.round((totalWeight / weights[index]) * 2) / 2)),
        rounds: golfer.rounds,
        ...(golfer.finish ? { finish: golfer.finish } : {}),
        ...(golfer.withdrawnThru !== undefined ? { withdrawnThru: golfer.withdrawnThru } : {}),
      }))
      .sort((left, right) => left.oddsToWin - right.oddsToWin || left.ranking - right.ranking),
  };
}

function buildTour(scheduleFile: string, playersFile: string): GolfSeedTour {
  const schedule = readJson(scheduleFile) as TourFile;
  const ranked = (readJson(playersFile) as PlayersFile).players;
  const players: GolfSeedPlayer[] = ranked.map((player) => ({
    key: player.playerId,
    name: player.name,
    countryCode: player.countryCode,
    ranking: player.ranking,
  }));
  let nextRanking = Math.max(...players.map((player) => player.ranking)) + 1;
  for (const extra of EXTRA_PLAYERS[schedule.tour] ?? []) {
    players.push({ key: `${schedule.tourId}-${slug(extra.name)}`, name: extra.name, countryCode: extra.countryCode, ranking: nextRanking });
    nextRanking += 1;
  }
  const tour: GolfSeedTour = { name: schedule.tour, players, events: [] };
  tour.events = schedule.events.map((event) => buildEvent(tour, event));
  return tour;
}

const seed: GolfSeedFile = {
  season: 2026,
  notes: 'Built by build-golf-2026.ts. Schedules and players from public sources; winners public where known (event.winner = "public"), every other result, field and odds made up. Not authoritative.',
  tours: [
    buildTour('pga-tour-2026.json', 'pga-tour-players.json'),
    buildTour('lpga-tour-2026.json', 'lpga-tour-players.json'),
  ],
};

writeFileSync(outputPath, `${JSON.stringify(seed)}\n`);
const events = seed.tours.flatMap((tour) => tour.events);
console.log(`Wrote ${outputPath}: ${events.length} events, ${events.reduce((sum, event) => sum + event.field.length, 0)} field rows.`);
