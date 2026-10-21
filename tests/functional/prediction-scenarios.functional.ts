import {
  acceptInvitation,
  createContest,
  enterContest,
  generateInviteLink,
  getBracketLeaderboard,
  getContest,
  getEventBracket,
  getGamePicks,
  getPickEmLeaderboard,
  getSurvivorLeaderboard,
  listEventParticipants,
  listEvents,
  listSportLeagues,
  openContest,
  saveGamePicks,
  submitGamePicks,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestEntryStatus, ContestFormat, ContestStatus, MatchSide, PickEmMode, PredictedResult, SelectionType, Sport } from '@poolmaster/shared/domain';
import {
  BracketLeaderboardResponseSchema,
  GamePicksResponseSchema,
  PickEmLeaderboardResponseSchema,
  SportEventBracketResponseSchema,
  SurvivorLeaderboardResponseSchema,
  type GamePicksResponse,
  type SportEventMatchDto,
} from '@poolmaster/shared/dto';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { enterSeedRound, oneEventOf, placeSeedRound, playedSeedEvent } from '../support/sport-test-seed';

// One bracket pool and one playoff survivor pool on every playoff league's last-season test seed
// (#785, #786), through the SDK: the College Football Playoff with its four byes, the NFL reseeded
// after Wild Card weekend and the Divisional round, the NBA with its play-in places filled, the
// WNBA, and men's and women's March Madness with their First Four places.
//
// Each row loads the event twice: once as played, to read which team won each game, and once
// released and unplayed, to run the contest on. The contest's entries pick before the event
// starts, then each round's real results go in, a reseeded round placed first as an admin would.
//
// - Bracket: one entry picks every real winner and gives the final's real total as its
//   tiebreaker; the other picks the better seed in every game it predicts. A bye is no game, so it
//   is never picked and scores nothing. The perfect entry takes every point; the other scores the
//   round value of each pick whose team won its game in that round, which is the knockout rule
//   whether the bracket links its rounds or reseeds them.
// - Survivor: one entry picks, in each round, a winner it has not used that goes out in the next
//   round (the champion in the final), so it survives every round; the other picks a first-round
//   loser and is out in week 1.
//
// A straight-up pick'em pool runs on week 1 of the 2025 NFL season the same way: one entry picks
// every real winner, the other every home team, and each scores a point for each game it called.
// Soccer weeks (#787) do too, the Premier League's matchweek 1 and the Women's World Cup's first
// group matchday, with the real result picked as a draw where the game was drawn; and a Last Man
// Standing pool on matchweek 1 puts out the entry whose team drew.

const RUN = `playoff-scenario-${Date.now()}`;

interface PlayoffLeague {
  sport: Sport;
  file: string;
  league: string;
  event: string;
}

const LEAGUES: readonly PlayoffLeague[] = [
  { sport: Sport.AMERICAN_FOOTBALL, file: 'american-football-2025-cfp-test.json', league: 'College Football Playoff', event: 'College Football Playoff' },
  { sport: Sport.AMERICAN_FOOTBALL, file: 'american-football-2026-nfl-playoffs-test.json', league: 'NFL', event: 'NFL Playoffs' },
  { sport: Sport.BASKETBALL, file: 'basketball-2025-nba-playoffs-test.json', league: 'NBA', event: 'NBA Playoffs' },
  { sport: Sport.BASKETBALL, file: 'basketball-2025-wnba-playoffs-test.json', league: 'WNBA', event: 'WNBA Playoffs' },
  { sport: Sport.BASKETBALL, file: 'basketball-2026-ncaa-tournaments-test.json', league: 'NCAA Division I Men', event: 'NCAA Men\'s Tournament' },
  { sport: Sport.BASKETBALL, file: 'basketball-2026-ncaa-tournaments-test.json', league: 'NCAA Division I Women', event: 'NCAA Women\'s Tournament' },
  { sport: Sport.HOCKEY, file: 'hockey-2026-nhl-playoffs-test.json', league: 'NHL', event: 'Stanley Cup Playoffs' },
  { sport: Sport.HOCKEY, file: 'hockey-2026-pwhl-playoffs-test.json', league: 'PWHL', event: 'Walter Cup Playoffs' },
  { sport: Sport.HOCKEY, file: 'hockey-2026-ncaa-tournaments-test.json', league: 'NCAA Division I Men', event: 'NCAA Men\'s Ice Hockey Tournament' },
  { sport: Sport.HOCKEY, file: 'hockey-2026-ncaa-tournaments-test.json', league: 'NCAA Division I Women', event: 'NCAA Women\'s Ice Hockey Tournament' },
  { sport: Sport.BASEBALL, file: 'baseball-2025-mlb-postseason-test.json', league: 'MLB', event: 'MLB Postseason' },
  { sport: Sport.SOCCER, file: 'soccer-2022-fifa-world-cup-test.json', league: 'FIFA World Cup', event: 'FIFA World Cup' },
  { sport: Sport.SOCCER, file: 'soccer-2023-fifa-womens-world-cup-test.json', league: 'FIFA Women\'s World Cup', event: 'FIFA Women\'s World Cup' },
  { sport: Sport.SOCCER, file: 'soccer-2024-uefa-euro-test.json', league: 'UEFA European Championship', event: 'UEFA Euro' },
  { sport: Sport.SOCCER, file: 'soccer-2024-copa-america-test.json', league: 'Copa América', event: 'Copa América' },
  { sport: Sport.SOCCER, file: 'soccer-2026-uefa-champions-league-test.json', league: 'UEFA Champions League', event: 'UEFA Champions League' },
  { sport: Sport.SOCCER, file: 'soccer-2025-mls-cup-playoffs-test.json', league: 'MLS', event: 'MLS Cup Playoffs' },
  { sport: Sport.SOCCER, file: 'soccer-2025-nwsl-playoffs-test.json', league: 'NWSL', event: 'NWSL Playoffs' },
  { sport: Sport.SOCCER, file: 'soccer-2025-ncaa-tournaments-test.json', league: 'NCAA Division I Men', event: 'NCAA Men\'s Soccer Tournament' },
  { sport: Sport.SOCCER, file: 'soccer-2025-ncaa-tournaments-test.json', league: 'NCAA Division I Women', event: 'NCAA Women\'s Soccer Tournament' },
];

/**
 * Each copy of an event loads into a year of its own: the loader takes a stored event of the same
 * league and year that starts within a few days for the file's event renamed, so the played copy
 * and the two contests' copies must never share a year, nor share one with another suite.
 */
const SEASON = { played: 2095, [SelectionType.BRACKET]: 2096, [SelectionType.SURVIVOR]: 2097, [SelectionType.PICK_EM]: 2098 } as const;

const PREDICTION_TYPES = [SelectionType.BRACKET, SelectionType.SURVIVOR] as const;
const ROWS = LEAGUES.flatMap((league) => PREDICTION_TYPES.map((selectionType) => ({ ...league, selectionType })));

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = (await db.sportEvent.findMany({ where: { name: { contains: RUN } }, select: { id: true } })).map((event) => event.id);
  if (eventIds.length) {
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    const field = { sportEventParticipant: { sportEventId: { in: eventIds } } };
    await db.contestEntryMatchPrediction.deleteMany({ where: { sportEventMatch: { sportEventId: { in: eventIds } } } });
    await unlinkContestsFromSportEvents(db, eventIds);
    await db.sportEventMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: field });
    await db.sportEventParticipantValuation.deleteMany({ where: field });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.eventSeries.deleteMany({ where: { id: { in: seriesIds } } });
  }
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((row) => row.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
}

let admin: RegisteredUserContext;

beforeAll(async () => {
  admin = await buildRegisteredUser({ displayName: 'Playoff Scenario Director' });
  await promoteToRootAdmin(admin);
});

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** Loads one copy of the row's event, tagged `tag`, and answers its id and its field by participant name. */
async function loadCopy(row: PlayoffLeague, tag: string, season: number, withoutResults: boolean) {
  const file = oneEventOf(row.file, row.league, row.event, { withoutResults })(tag, season);
  await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.APPLY });
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: admin.client, query: { sport: row.sport } })).data).sportLeagues
    .find((each) => each.name === row.league), row.league);
  const eventId = expectDefined(expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId: sportLeague.id } })).data).events
    .find((each) => each.name === file.sportLeagues[0].events[0].name), file.sportLeagues[0].events[0].name).id;
  const field = expectDefined((await listEventParticipants({ client: admin.client, path: { eventId } })).data).participants;
  return { eventId, field };
}

async function bracketOf(eventId: string): Promise<SportEventMatchDto[]> {
  return expectMatchesSchema(SportEventBracketResponseSchema, (await getEventBracket({ client: admin.client, path: { eventId } })).data).matches;
}

/** The played event's winners and losers of each round, by team name, and the final's total points. */
async function playedResults(row: PlayoffLeague, tag: string) {
  const { eventId, field } = await loadCopy(row, `${tag}-played`, SEASON.played, false);
  const nameOf = (rowId: string | null) => expectDefined(field.find((each) => each.id === rowId), `field row ${rowId ?? 'none'}`).participant.name;
  const winners = new Map<number, Set<string>>();
  const losers = new Map<number, Set<string>>();
  const matches = await bracketOf(eventId);
  for (const match of matches) {
    const home = nameOf(match.homeSportEventParticipantId);
    const away = nameOf(match.awaySportEventParticipantId);
    const [won, lost] = match.winnerSide === MatchSide.HOME ? [home, away] : [away, home];
    winners.set(match.roundNumber, (winners.get(match.roundNumber) ?? new Set()).add(won));
    losers.set(match.roundNumber, (losers.get(match.roundNumber) ?? new Set()).add(lost));
  }
  const rounds = Math.max(...matches.map((match) => match.roundNumber));
  const final = expectDefined(matches.find((match) => match.roundNumber === rounds), 'the final');
  return { winners, losers, rounds, gameCount: matches.length, finalTotal: (final.homeScore ?? 0) + (final.awayScore ?? 0) };
}

type Team = NonNullable<GamePicksResponse['games'][number]['predictedHome']>;

describe('SDK Functional: a bracket pool and a playoff survivor pool on every playoff league\'s test seed', () => {
  it.each(ROWS.map((row) => [row.event, row.selectionType, row] as const))(
    '%s, %s: the entry that picks the real winners takes every point or survives every round, and the other is scored by the knockout rule',
    async (_event, selectionType, row) => {
      const tag = `${RUN}-${row.event}-${selectionType}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const played = await playedResults(row, tag);
      const { eventId, field } = await loadCopy(row, tag, SEASON[selectionType], true);
      const seed = playedSeedEvent(row.file, row.league, row.event);
      const a = admin.client;
      const nameOfRow = (rowId: string) => expectDefined(field.find((each) => each.id === rowId), rowId).participant.name;
      const seedOfRow = (rowId: string) => field.find((each) => each.id === rowId)?.seedNumber ?? Number.MAX_SAFE_INTEGER;
      const won = (roundNumber: number, rowId: string) => expectDefined(played.winners.get(roundNumber)).has(nameOfRow(rowId));

      // --- A league of two, and a contest on the unplayed event -----------------------------------
      const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Playoff Scenario Perfect', leagueName: `Playoff Scenario ${tag}` });
      const other = await buildRegisteredUser({ displayName: 'Playoff Scenario Other' });
      const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
      await acceptInvitation({ client: other.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
      const roundValues = Array.from({ length: played.rounds }, (_, index) => 2 ** index);
      const contest = await createContest({
        client: commissioner.client,
        path: { id: league.id },
        body: {
          name: `Playoff Scenario ${tag}`,
          sportEventIds: [eventId],
          contestFormat: ContestFormat.PREDICTION,
          selectionType,
          configuration: selectionType === SelectionType.BRACKET
            ? {
              selectionType,
              startsAtRound: 1,
              maxEntriesPerSquad: 1,
              scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues, upsetBonus: { rule: 'NONE' } } },
            }
            : { selectionType, maxEntriesPerSquad: 1 },
        },
      });
      expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
      const contestId = expectDefined(contest.data).contest.id;
      expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
      const perfect = { client: commissioner.client, entryId: expectDefined((await enterContest({ client: commissioner.client, path: { contestId } })).data).entry.id };
      const rival = { client: other.client, entryId: expectDefined((await enterContest({ client: other.client, path: { contestId } })).data).entry.id };
      const path = (entryId: string) => ({ contestId, entryId, sportEventId: eventId });
      const view = async (entrant: typeof perfect) =>
        expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client: entrant.client, path: path(entrant.entryId) })).data);

      if (selectionType === SelectionType.BRACKET) {
        // --- Both brackets filled in round by round, each round's games built on the picks before ---
        const fill = async (entrant: typeof perfect, choose: (roundNumber: number, sides: Team[]) => Team, tiebreakerValue: number) => {
          for (let roundNumber = 1; roundNumber <= played.rounds; roundNumber += 1) {
            const games = (await view(entrant)).games.filter((game) => game.roundNumber === roundNumber);
            const picks = games.map((game) => {
              const sides = [game.predictedHome, game.predictedAway].filter((team): team is Team => team !== null);
              expect(sides).toHaveLength(2);
              return { sportEventMatchId: game.sportEventMatchId, predictedResult: PredictedResult.TEAM, sportEventParticipantId: choose(roundNumber, sides).sportEventParticipantId, confidence: null };
            });
            const saved = await saveGamePicks({ client: entrant.client, path: path(entrant.entryId), body: { picks, ...(roundNumber === played.rounds ? { tiebreakerValue } : {}) } });
            expect(saved.error).toBeUndefined();
          }
          const filled = await view(entrant);
          // Every game is picked; a team on a bye is in no first-round game, so it is never picked there.
          expect([filled.gameCount, filled.pickedCount]).toEqual([played.gameCount, played.gameCount]);
          expect((await submitGamePicks({ client: entrant.client, path: path(entrant.entryId) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
          return filled;
        };
        await fill(perfect, (roundNumber, sides) => expectDefined(sides.find((team) => won(roundNumber, team.sportEventParticipantId)), `round ${roundNumber}'s winner`), played.finalTotal);
        const rivalBracket = await fill(rival, (_roundNumber, sides) => [...sides].sort((left, right) => seedOfRow(left.sportEventParticipantId) - seedOfRow(right.sportEventParticipantId))[0], 0);

        await playOut(eventId, seed, played.rounds);

        const board = expectMatchesSchema(BracketLeaderboardResponseSchema, (await getBracketLeaderboard({ client: other.client, path: { contestId } })).data);
        const perfectPoints = roundValues.reduce((sum, value, index) => sum + value * expectDefined(played.winners.get(index + 1)).size, 0);
        const rivalPoints = rivalBracket.games.reduce((sum, game) => {
          const pickId = expectDefined(expectDefined(game.pick, `game ${game.matchNumber}'s pick`).sportEventParticipantId, `game ${game.matchNumber}'s picked team`);
          return sum + (won(game.roundNumber, pickId) ? roundValues[game.roundNumber - 1] : 0);
        }, 0);
        expect(board.finalTotalPoints).toBe(played.finalTotal);
        expect(board.entries.map((entry) => [entry.entryId, entry.points, entry.maxPossiblePoints])).toEqual([
          [perfect.entryId, perfectPoints, perfectPoints],
          [rival.entryId, rivalPoints, rivalPoints],
        ]);
        expect(board.entries[0].correctPickCount).toBe(played.gameCount);
        expect(rivalPoints).toBeLessThan(perfectPoints);
        await expectSettled(contestId, other.client, [[perfect.entryId, perfectPoints], [rival.entryId, rivalPoints]]);
        return;
      }

      // --- Survivor: one pick a round, the rival out on a first-round loser ---------------------------
      const used = new Set<string>();
      const survivorPick = async (entrant: typeof perfect, roundNumber: number, choose: (teams: string[]) => string) => {
        const games = (await bracketOf(eventId)).filter((match) => match.roundNumber === roundNumber);
        const teams = games.flatMap((match) => [match.homeSportEventParticipantId, match.awaySportEventParticipantId]).filter((id): id is string => id !== null);
        const team = choose(teams);
        const game = expectDefined(games.find((match) => match.homeSportEventParticipantId === team || match.awaySportEventParticipantId === team));
        const saved = await saveGamePicks({ client: entrant.client, path: path(entrant.entryId), body: { picks: [{ sportEventMatchId: game.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: team }] } });
        expect(saved.error).toBeUndefined();
        used.add(team);
      };
      /** A round's winner not used yet, one that goes out in the next round, or the champion in the final. */
      const perfectChoice = (roundNumber: number) => (teams: string[]) => expectDefined(teams.find((team) => !used.has(team) && won(roundNumber, team)
        && (roundNumber === played.rounds || !won(roundNumber + 1, team))), `a round ${roundNumber} pick`);

      await survivorPick(perfect, 1, perfectChoice(1));
      await survivorPick(rival, 1, (teams) => expectDefined(teams.find((team) => expectDefined(played.losers.get(1)).has(nameOfRow(team))), 'a first-round loser'));
      for (const entrant of [perfect, rival]) {
        expect((await submitGamePicks({ client: entrant.client, path: path(entrant.entryId) })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
      }
      expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
      for (let roundNumber = 1; roundNumber <= played.rounds; roundNumber += 1) {
        if (roundNumber > 1) {
          await placeSeedRound(a, eventId, seed, roundNumber);
          await survivorPick(perfect, roundNumber, perfectChoice(roundNumber));
        }
        await enterSeedRound(a, eventId, seed, roundNumber);
      }
      expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');

      const board = expectMatchesSchema(SurvivorLeaderboardResponseSchema, (await getSurvivorLeaderboard({ client: other.client, path: { contestId } })).data);
      expect(board.weeks.map((week) => week.roundNumber)).toEqual(roundValues.map((_, index) => index + 1));
      expect(board.entries.map((entry) => [entry.entryId, entry.alive, entry.eliminatedInWeek, entry.weeksSurvived])).toEqual([
        [perfect.entryId, true, null, played.rounds],
        [rival.entryId, false, 1, 0],
      ]);
      await expectSettled(contestId, other.client, [[perfect.entryId, played.rounds], [rival.entryId, 0]]);
    },
    180_000,
  );
});

describe('SDK Functional: a pick\'em pool on the NFL weeks test seed', () => {
  it('scores a point for each game an entry called on week 1 as played: every point to the entry that picked the winners, the home teams\' wins to the other', async () => {
    const week: PlayoffLeague = { sport: Sport.AMERICAN_FOOTBALL, file: 'american-football-2025-nfl-weeks-test.json', league: 'NFL', event: 'NFL Week 1' };
    const tag = `${RUN}-nfl-week-1-pick-em`;
    const { eventId, field } = await loadCopy(week, tag, SEASON[SelectionType.PICK_EM], true);
    const seed = playedSeedEvent(week.file, week.league, week.event);
    const nameOfRow = (rowId: string) => expectDefined(field.find((each) => each.id === rowId), rowId).participant.name;
    const players = new Map(oneEventOf(week.file, week.league, week.event)(tag, SEASON[SelectionType.PICK_EM]).sportLeagues[0].players
      .map((player) => [player.key.replace(`${tag}-`, ''), player.name]));
    const matches = seed.matches ?? [];
    const winnerName = (matchNumber: number) => {
      const match = expectDefined(matches.find((each) => each.matchNumber === matchNumber));
      return players.get(expectDefined(expectDefined(match.result).winner === MatchSide.HOME ? match.home : match.away));
    };
    const last = expectDefined(matches.at(-1));
    const lastTotal = expectDefined(expectDefined(last.result).homeScore) + expectDefined(expectDefined(last.result).awayScore);
    const homeWins = matches.filter((match) => expectDefined(match.result).winner === MatchSide.HOME).length;

    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Pick\'em Scenario Perfect', leagueName: `Pick'em Scenario ${tag}` });
    const other = await buildRegisteredUser({ displayName: 'Pick\'em Scenario Home' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: other.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Pick'em Scenario ${tag}`,
        sportEventIds: [eventId],
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.PICK_EM,
        configuration: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false, maxEntriesPerSquad: 1 },
      },
    });
    expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    const pickWeek = async (client: RegisteredUserContext['client'], choose: (game: GamePicksResponse['games'][number]) => string, tiebreakerValue: number) => {
      const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
      const path = { contestId, entryId, sportEventId: eventId };
      const games = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client, path })).data).games;
      expect(games).toHaveLength(matches.length);
      const picks = games.map((game) => ({ sportEventMatchId: game.sportEventMatchId, predictedResult: PredictedResult.TEAM, sportEventParticipantId: choose(game), confidence: null }));
      expect((await saveGamePicks({ client, path, body: { picks, tiebreakerValue } })).error).toBeUndefined();
      expect((await submitGamePicks({ client, path })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
      return entryId;
    };
    const winnerRow = (game: GamePicksResponse['games'][number]) => expectDefined(
      [game.home, game.away].find((team) => team !== null && nameOfRow(team.sportEventParticipantId) === winnerName(game.matchNumber)),
      `game ${game.matchNumber}'s winner`,
    ).sportEventParticipantId;
    const perfect = await pickWeek(commissioner.client, winnerRow, lastTotal);
    const rival = await pickWeek(other.client, (game) => expectDefined(game.home).sportEventParticipantId, 0);

    await playOut(eventId, seed, 1);

    const board = expectMatchesSchema(PickEmLeaderboardResponseSchema, (await getPickEmLeaderboard({ client: other.client, path: { contestId } })).data);
    expect(board.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.totalPoints])).toEqual([
      [perfect, '1', matches.length],
      [rival, '2', homeWins],
    ]);
    await expectSettled(contestId, other.client, [[perfect, matches.length], [rival, homeWins]]);
  }, 120_000);
});

const SOCCER_WEEKS: readonly PlayoffLeague[] = [
  { sport: Sport.SOCCER, file: 'soccer-2025-premier-league-weeks-test.json', league: 'Premier League', event: 'Premier League Matchweek 1' },
  { sport: Sport.SOCCER, file: 'soccer-2023-fifa-womens-world-cup-group-matchdays-test.json', league: 'FIFA Women\'s World Cup', event: 'FIFA Women\'s World Cup Matchday 1' },
];

/** A week of the seed loaded unplayed, a league of two on it, and the real result of each of its games by team name. */
async function soccerWeek(week: PlayoffLeague, tag: string, season: number) {
  const { eventId, field } = await loadCopy(week, tag, season, true);
  const seed = playedSeedEvent(week.file, week.league, week.event);
  const players = new Map(oneEventOf(week.file, week.league, week.event)(tag, season).sportLeagues[0].players
    .map((player) => [player.key.replace(`${tag}-`, ''), player.name]));
  const matches = seed.matches ?? [];
  const nameOfRow = (rowId: string) => expectDefined(field.find((each) => each.id === rowId), rowId).participant.name;
  /** The game's real winner by name, or null for a draw. */
  const winnerName = (matchNumber: number) => {
    const result = expectDefined(expectDefined(matches.find((each) => each.matchNumber === matchNumber)).result);
    const match = expectDefined(matches.find((each) => each.matchNumber === matchNumber));
    return result.winner === null ? null : expectDefined(players.get(expectDefined(result.winner === MatchSide.HOME ? match.home : match.away)));
  };
  const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Soccer Week Perfect', leagueName: `Soccer Week ${tag}` });
  const other = await buildRegisteredUser({ displayName: 'Soccer Week Other' });
  const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
  await acceptInvitation({ client: other.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
  return { eventId, seed, matches, nameOfRow, winnerName, commissioner, other, league };
}

describe('SDK Functional: soccer week pools with draw picks, on the Premier League and Women\'s World Cup matchday test seeds', () => {
  it.each(SOCCER_WEEKS.map((week) => [week.event, week] as const))(
    '%s, pick\'em: the entry that calls every result, draws included, scores a point a game, and the entry that picks every home team only for home wins',
    async (_event, week) => {
      const tag = `${RUN}-${week.event}-pick-em`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const { eventId, seed, matches, nameOfRow, winnerName, commissioner, other, league } = await soccerWeek(week, tag, SEASON[SelectionType.PICK_EM]);
      const draws = matches.filter((match) => expectDefined(match.result).winner === null).length;
      const homeWins = matches.filter((match) => expectDefined(match.result).winner === MatchSide.HOME).length;
      expect(draws).toBeGreaterThan(0);

      const contest = await createContest({
        client: commissioner.client,
        path: { id: league.id },
        body: {
          name: `Soccer Week ${tag}`,
          sportEventIds: [eventId],
          contestFormat: ContestFormat.PREDICTION,
          selectionType: SelectionType.PICK_EM,
          configuration: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false, maxEntriesPerSquad: 1 },
        },
      });
      expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
      const contestId = expectDefined(contest.data).contest.id;
      expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

      type Game = GamePicksResponse['games'][number];
      const pickWeek = async (client: RegisteredUserContext['client'], choose: (game: Game) => { predictedResult: PredictedResult; sportEventParticipantId: string | null }) => {
        const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
        const path = { contestId, entryId, sportEventId: eventId };
        const games = expectMatchesSchema(GamePicksResponseSchema, (await getGamePicks({ client, path })).data).games;
        expect(games).toHaveLength(matches.length);
        const picks = games.map((game) => ({ sportEventMatchId: game.sportEventMatchId, ...choose(game), confidence: null }));
        expect((await saveGamePicks({ client, path, body: { picks, tiebreakerValue: 0 } })).error).toBeUndefined();
        expect((await submitGamePicks({ client, path })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
        return entryId;
      };
      const realResult = (game: Game) => {
        const winner = winnerName(game.matchNumber);
        if (winner === null) return { predictedResult: PredictedResult.TIE, sportEventParticipantId: null };
        const team = expectDefined([game.home, game.away].find((side) => side !== null && nameOfRow(side.sportEventParticipantId) === winner), `game ${game.matchNumber}'s winner`);
        return { predictedResult: PredictedResult.TEAM, sportEventParticipantId: team.sportEventParticipantId };
      };
      const perfect = await pickWeek(commissioner.client, realResult);
      const rival = await pickWeek(other.client, (game) => ({ predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(game.home).sportEventParticipantId }));

      await playOut(eventId, seed, 1);

      const board = expectMatchesSchema(PickEmLeaderboardResponseSchema, (await getPickEmLeaderboard({ client: other.client, path: { contestId } })).data);
      expect(board.entries.map((entry) => [entry.entryId, entry.displayPosition, entry.totalPoints])).toEqual([
        [perfect, '1', matches.length],
        [rival, '2', homeWins],
      ]);
      await expectSettled(contestId, other.client, [[perfect, matches.length], [rival, homeWins]]);
    },
    120_000,
  );

  it('Premier League Matchweek 1, Last Man Standing: a pick that wins survives the week, and a pick on a team that drew is out', async () => {
    const week = SOCCER_WEEKS[0];
    const tag = `${RUN}-premier-league-matchweek-1-survivor`;
    const { eventId, seed, matches, nameOfRow, winnerName, commissioner, other, league } = await soccerWeek(week, tag, SEASON[SelectionType.SURVIVOR]);
    const contest = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Soccer Week ${tag}`,
        sportEventIds: [eventId],
        contestFormat: ContestFormat.PREDICTION,
        selectionType: SelectionType.SURVIVOR,
        configuration: { selectionType: SelectionType.SURVIVOR, reuseTeamsOnceAllUsed: true, maxEntriesPerSquad: 1 },
      },
    });
    expect([contest.error, contest.response.status]).toEqual([undefined, 201]);
    const contestId = expectDefined(contest.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

    const games = await bracketOf(eventId);
    const won = expectDefined(games.find((game) => winnerName(game.matchNumber) !== null), 'a game with a winner');
    const winner = expectDefined([won.homeSportEventParticipantId, won.awaySportEventParticipantId]
      .find((rowId) => rowId !== null && nameOfRow(rowId) === winnerName(won.matchNumber)));
    const drawn = expectDefined(games.find((game) => winnerName(game.matchNumber) === null), 'a drawn game');
    const pick = async (client: RegisteredUserContext['client'], gameId: string, team: string) => {
      const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
      const path = { contestId, entryId, sportEventId: eventId };
      expect((await saveGamePicks({ client, path, body: { picks: [{ sportEventMatchId: gameId, predictedResult: PredictedResult.TEAM, sportEventParticipantId: team }] } })).error).toBeUndefined();
      expect((await submitGamePicks({ client, path })).data?.status).toBe(ContestEntryStatus.SUBMITTED);
      return entryId;
    };
    const survivor = await pick(commissioner.client, won.id, winner);
    const drew = await pick(other.client, drawn.id, expectDefined(drawn.homeSportEventParticipantId));
    expect(matches.length).toBe(games.length);

    await playOut(eventId, seed, 1);

    const board = expectMatchesSchema(SurvivorLeaderboardResponseSchema, (await getSurvivorLeaderboard({ client: other.client, path: { contestId } })).data);
    expect(board.entries.map((entry) => [entry.entryId, entry.alive, entry.eliminatedInWeek, entry.weeksSurvived])).toEqual([
      [survivor, true, null, 1],
      [drew, false, 1, 0],
    ]);
    await expectSettled(contestId, other.client, [[survivor, 1], [drew, 0]]);
  }, 120_000);
});

/** Starts the event, enters each round's real results (placing a reseeded round first), and completes it. */
async function playOut(eventId: string, seed: ReturnType<typeof playedSeedEvent>, rounds: number): Promise<void> {
  const a = admin.client;
  expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
  for (let roundNumber = 1; roundNumber <= rounds; roundNumber += 1) {
    await placeSeedRound(a, eventId, seed, roundNumber);
    await enterSeedRound(a, eventId, seed, roundNumber);
  }
  expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
}

/** The contest is COMPLETED with each entry's settled total, best first. */
async function expectSettled(contestId: string, client: RegisteredUserContext['client'], totals: Array<[string, number]>): Promise<void> {
  expect(expectDefined((await getContest({ client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
  const settled = await getFunctionalPrisma().contestEntryStanding.findMany({ where: { contestId }, orderBy: { position: 'asc' } });
  expect(settled.map((standing) => [standing.contestEntryId, standing.totalScore])).toEqual(totals);
}
