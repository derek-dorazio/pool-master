import {
  acceptInvitation,
  createContest,
  enterContest,
  generateInviteLink,
  getContest,
  getContestLeaderboard,
  getSelectionState,
  listContestConfigTemplates,
  listEvents,
  listSportLeagues,
  openContest,
  runContestDraw,
  submitContestEntry,
  submitContestSelection,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import {
  ContestFormat,
  ContestStatus,
  PARTICIPANT_SCORING_DEFINITIONS,
  SelectionType,
  Sport,
  compareScores,
} from '@poolmaster/shared/domain';
import {
  ContestLeaderboardResponseSchema,
  SelectionStateResponseSchema,
  type ContestEntryStandingDto,
  type ScoredContestEntryPickDto,
  type SelectionStateResponse,
} from '@poolmaster/shared/dto';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import {
  TEST_SEED_CONTENTS,
  parseSportDataFile,
  type SportDataFile,
} from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { inSeason, oneEventOf } from '../support/sport-test-seed';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { expectMatchesSchema } from '../support/expect-matches-schema';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';

// One journey for every sport x selection type (#748), through the SDK. Each row loads one played
// event of its sport from a test seed (golf's strokes are made up; the other sports' results are
// the real ones), creates a contest from the sport league's preset for that selection type, enters
// two teams, picks for each the way the selection type picks (a lineup within the tiers, a lineup
// within the salary cap, or the commissioner's draw), submits, plays the event out and settles it.
// The settled board must rank the two entries by their totals, and each total must be the sum of
// the entry's best N picks under the contest's counting rule.
//
// The seeds are dated from today by the loader, so no row depends on today's date. Each row loads
// its own copy of the event, tagged with this run and the selection type, so the rows never share
// a field or a contest. League presets are each checked on their own by the preset invariant in
// contest-template-reference-data.integration; this suite proves one preset per sport and type
// end to end. The prediction types run on the playoff seeds in prediction-scenarios (bracket and
// survivor on every playoff league), squares in squares, and pick'em on the NFL weeks seed in prediction-scenarios too.

const RUN = `scenario-${Date.now()}`;
const SELECTION_TYPES = [SelectionType.TIERED, SelectionType.BUDGET_PICK, SelectionType.RANDOM_DRAW] as const;

interface SportScenario {
  sport: Sport;
  /** The one-event seed this row loads, its players and event tagged with `tag`, in `season`. */
  seed: (tag: string, season: number) => SportDataFile;
}

/**
 * Golf has no played seed: its test seeds carry made-up strokes. Thirty golfers over two rounds
 * at par 72, each a stroke apart, with one missing the cut; the tour is the run's own, so the
 * sport-wide golf presets apply.
 */
function golfEvent(tag: string, season: number): SportDataFile {
  const tour = `Scenario Tour ${tag}`;
  const golfers = Array.from({ length: 30 }, (_, index) => index + 1);
  return inSeason(parseSportDataFile(JSON.parse(JSON.stringify({
    schemaVersion: 1,
    scope: { sport: Sport.GOLF, season: 2026, sportLeagues: [tour], contents: [...TEST_SEED_CONTENTS] },
    testData: true,
    provenance: { gatheredAt: '2026-10-18', gatheredBy: 'functional test', sources: [{ name: 'Made-up strokes', url: 'https://example.com/scenario' }] },
    sportLeagues: [{
      name: tour,
      players: golfers.map((number) => ({ key: `${tag}-g${number}`, name: `Scenario Golfer ${number} ${tag}`, countryCode: 'US', ranking: number })),
      events: [{
        key: 'scenario-open',
        name: `Scenario Open ${tag}`,
        startDate: '2026-01-15',
        endDate: '2026-01-16',
        venue: null,
        location: null,
        rounds: 2,
        roundsPar: 72,
        winner: 'generated',
        field: golfers.map((number) => ({
          player: `${tag}-g${number}`,
          ranking: number,
          oddsToWin: 4 + number,
          ...(number === 30 ? { rounds: [80, 81], finish: 'MC' } : { rounds: [66 + Math.floor(number / 2), 66 + Math.ceil(number / 2)] }),
        })),
      }],
    }],
  })) as unknown, { allowTestData: true }), season);
}

const SPORTS: readonly SportScenario[] = [
  { sport: Sport.GOLF, seed: golfEvent },
  { sport: Sport.HORSE_RACING, seed: oneEventOf('horse-racing-2026-test.json', 'US Thoroughbred', 'Kentucky Derby') },
  { sport: Sport.AUTO_RACING, seed: oneEventOf('auto-racing-2026-test.json', 'NASCAR Cup Series', 'Daytona 500') },
  { sport: Sport.CYCLING, seed: oneEventOf('cycling-2026-test.json', 'UCI WorldTour', 'Tour de France') },
  { sport: Sport.RUNNING, seed: oneEventOf('running-2026-test.json', 'World Marathon Majors (men)', 'Boston Marathon') },
  { sport: Sport.BASKETBALL, seed: oneEventOf('basketball-2025-nba-playoffs-test.json', 'NBA', 'NBA Playoffs') },
  { sport: Sport.AMERICAN_FOOTBALL, seed: oneEventOf('american-football-2026-nfl-playoffs-test.json', 'NFL', 'NFL Playoffs') },
  { sport: Sport.HOCKEY, seed: oneEventOf('hockey-2026-nhl-playoffs-test.json', 'NHL', 'Stanley Cup Playoffs') },
  { sport: Sport.BASEBALL, seed: oneEventOf('baseball-2025-mlb-postseason-test.json', 'MLB', 'MLB Postseason') },
  { sport: Sport.SOCCER, seed: oneEventOf('soccer-2022-fifa-world-cup-test.json', 'FIFA World Cup', 'FIFA World Cup') },
  { sport: Sport.TENNIS, seed: oneEventOf('tennis-2026-us-open-test.json', 'ATP', 'US Open') },
];

/**
 * Each selection type's rows load into an event year of their own. The loader takes a stored event
 * of the same league and year that starts within a few days for the file's event renamed, and the
 * three rows of a sport load the same event on the same dates; a year apiece keeps them apart,
 * and far from any year another suite loads.
 */
const SEASON_OF: Readonly<Record<(typeof SELECTION_TYPES)[number], number>> = {
  [SelectionType.TIERED]: 2091,
  [SelectionType.BUDGET_PICK]: 2092,
  [SelectionType.RANDOM_DRAW]: 2093,
};

const SCENARIOS = SPORTS.flatMap((scenario) => SELECTION_TYPES.map((selectionType) => ({ ...scenario, selectionType })));

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = (await db.sportEvent.findMany({ where: { name: { contains: RUN } }, select: { id: true } })).map((event) => event.id);
  if (eventIds.length) {
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    const field = { sportEventParticipant: { sportEventId: { in: eventIds } } };
    await unlinkContestsFromSportEvents(db, eventIds);
    await db.contestEntryPick.deleteMany({ where: field });
    await db.sportEventMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: field } });
    await db.sportEventParticipantRound.deleteMany({ where: field });
    await db.sportEventParticipantGolfStanding.deleteMany({ where: { standing: field } });
    await db.sportEventParticipantRaceResult.deleteMany({ where: field });
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
  const ownLeagues = await db.sportLeague.findMany({ where: { name: { contains: RUN } }, select: { id: true } });
  await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: ownLeagues.map((league) => league.id) } } });
  await db.sportLeague.deleteMany({ where: { id: { in: ownLeagues.map((league) => league.id) } } });
}

let admin: RegisteredUserContext;

beforeAll(async () => {
  admin = await buildRegisteredUser({ displayName: 'Scenario Director' });
  await promoteToRootAdmin(admin);
});

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** Loads the row's event and answers it with its sport league. */
async function loadEvent(scenario: SportScenario, tag: string, season: number) {
  const file = scenario.seed(tag, season);
  await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.APPLY });
  const [league] = file.sportLeagues;
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: admin.client, query: { sport: scenario.sport } })).data).sportLeagues
    .find((row) => row.name === league.name), league.name);
  const event = expectDefined(expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId: sportLeague.id } })).data).events
    .find((row) => row.name === league.events[0].name), league.events[0].name);
  return { sportLeague, event };
}

/**
 * A lineup the room accepts. Tiered: each tier's `picksFromGroup`, the first entry from the top of
 * each tier and the second from the bottom. Budget: the first entry the cheapest lineup, the second
 * the cheapest but one swapped for the dearest the cap still allows, so the two differ.
 */
function lineupFor(room: SelectionStateResponse, order: 'FIRST' | 'SECOND'): string[] {
  const groups = expectDefined(room.selectionGroups, 'selection groups');
  if (room.selectionType === SelectionType.TIERED) {
    return groups.flatMap((group) => {
      const available = group.participants.filter((row) => row.isAvailable);
      const ordered = order === 'FIRST' ? available : [...available].reverse();
      return ordered.slice(0, group.picksFromGroup).map((row) => row.sportEventParticipantId);
    });
  }
  const priced = groups.flatMap((group) => group.participants)
    .filter((row) => row.isAvailable && row.price !== null && row.price !== undefined)
    .sort((left, right) => (left.price ?? 0) - (right.price ?? 0));
  const cheapest = priced.slice(0, room.rosterSize);
  if (order === 'FIRST') return cheapest.map((row) => row.sportEventParticipantId);
  const cap = expectDefined(room.lineupSummary, 'the budget summary').salaryCap;
  const kept = cheapest.slice(0, -1);
  const keptCost = kept.reduce((sum, row) => sum + (row.price ?? 0), 0);
  const swap = expectDefined([...priced].reverse().find((row) => !kept.includes(row) && keptCost + (row.price ?? 0) <= cap), 'a pick the cap allows');
  return [...kept, swap].map((row) => row.sportEventParticipantId);
}

/** The pick's score in its sport's block. */
function scoreOf(pick: ScoredContestEntryPickDto): number | null {
  return pick.golf?.scoreToPar ?? pick.race?.points ?? pick.knockout?.points ?? null;
}

/** An entry's best N pick scores summed, N the counting rule's count, best by the definition's direction. */
function expectedTotal(entry: ContestEntryStandingDto, count: number, direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER'): number {
  return entry.picks.map(scoreOf)
    .filter((score): score is number => score !== null)
    .sort((left, right) => compareScores(direction, left, right))
    .slice(0, count)
    .reduce((sum, score) => sum + score, 0);
}

describe('SDK Functional: one journey per sport and selection type', () => {
  it.each(SCENARIOS.map((scenario) => [scenario.sport, scenario.selectionType, scenario] as const))(
    '%s, %s: a contest from the league preset enters two teams, settles when the event completes and ranks them by the sum of each one\'s best counting picks',
    async (sport, selectionType, scenario) => {
      const tag = `${RUN}-${sport}-${selectionType}`.toLowerCase();
      const { sportLeague, event } = await loadEvent(scenario, tag, SEASON_OF[selectionType]);

      // --- A league of two teams, and a contest from the sport league's preset for the type ------
      const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Scenario Commissioner', leagueName: `Scenario ${tag}` });
      const member = await buildRegisteredUser({ displayName: 'Scenario Member' });
      const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
      await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

      const templates = expectDefined((await listContestConfigTemplates({
        client: commissioner.client,
        query: { sport, sportLeagueId: sportLeague.id, active: true },
      })).data).templates
        .filter((template) => template.contestFormat === ContestFormat.ROSTER)
        .filter((template) => template.selectionType === selectionType)
        .sort((left, right) => Number(right.sportLeagueId === sportLeague.id) - Number(left.sportLeagueId === sportLeague.id) || left.sortOrder - right.sortOrder);
      const preset = expectDefined(templates.at(0), `a ${selectionType} preset for ${sportLeague.name}`);

      const contest = await createContest({
        client: commissioner.client,
        path: { id: league.id },
        body: { name: `Scenario Pool ${tag}`, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType, templateId: preset.id },
      });
      expect([contest.response.status, contest.error]).toEqual([201, undefined]);
      const contestId = expectDefined(contest.data).contest.id;
      expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);

      // --- Both teams enter; each picks its lineup, or the commissioner draws them --------------
      const entrants = [commissioner, member];
      const entryIds: string[] = [];
      const lineups = new Map<string, string[]>();
      let drawnRosterSize: number | undefined;
      for (const entrant of entrants) {
        entryIds.push(expectDefined((await enterContest({ client: entrant.client, path: { contestId } })).data).entry.id);
      }
      if (selectionType === SelectionType.RANDOM_DRAW) {
        const drawn = expectMatchesSchema(SelectionStateResponseSchema, (await runContestDraw({ client: commissioner.client, path: { contestId } })).data);
        expect(drawn.entries.map((entry) => entry.status)).toEqual(['SUBMITTED', 'SUBMITTED']);
        drawnRosterSize = drawn.rosterSize;
      } else {
        for (const [index, entrant] of entrants.entries()) {
          const entryId = entryIds[index];
          const room = expectMatchesSchema(SelectionStateResponseSchema, (await getSelectionState({ client: entrant.client, path: { contestId }, query: { entryId } })).data);
          const lineup = lineupFor(room, index === 0 ? 'FIRST' : 'SECOND');
          lineups.set(entryId, lineup);
          for (const participantId of lineup) {
            const pick = await submitContestSelection({ client: entrant.client, path: { contestId }, body: { entryId, participantId } });
            expect([pick.response.status, pick.error]).toEqual([200, undefined]);
          }
          const submitted = await submitContestEntry({ client: entrant.client, path: { contestId, entryId, sportEventId: event.id } });
          expect([submitted.response.status, submitted.error]).toEqual([200, undefined]);
        }
      }

      if (selectionType === SelectionType.BUDGET_PICK) {
        expect([...lineups.values()][1].slice().sort()).not.toEqual([...lineups.values()][0].slice().sort());
      }

      // --- The event plays out and settles the contest ------------------------------------------
      expect((await transitionEvent({ client: admin.client, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
      expect((await transitionEvent({ client: admin.client, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
      expect(expectDefined((await getContest({ client: member.client, path: { contestId } })).data).contest.status).toBe(ContestStatus.COMPLETED);

      const board = expectMatchesSchema(ContestLeaderboardResponseSchema, (await getContestLeaderboard({ client: member.client, path: { contestId } })).data);
      const { direction } = PARTICIPANT_SCORING_DEFINITIONS[board.scoringDefinitionId];
      expect(board.sport).toBe(sport);
      expect(board.entries.map((entry) => entry.entryId).sort()).toEqual([...entryIds].sort());
      for (const entry of board.entries) {
        // The board shows exactly the lineup the entry submitted, or a full drawn roster.
        const picked = entry.picks.map((pick) => pick.sportEventParticipantId).sort();
        if (drawnRosterSize === undefined) expect(picked).toEqual(expectDefined(lineups.get(entry.entryId), entry.entryId).slice().sort());
        else expect(new Set(picked).size).toBe(drawnRosterSize);
        expect(entry.picks.some((pick) => scoreOf(pick) !== null)).toBe(true);
        expect(entry.totalScore).toBe(expectedTotal(entry, board.countingRule.count, direction));
        expect(entry.picks.filter((pick) => pick.isCounting)).toHaveLength(Math.min(board.countingRule.count, entry.scoredPickCount));
      }
      // Best total first, and the positions follow the totals.
      const [first, second] = board.entries;
      expect(compareScores(direction, first.totalScore, second.totalScore)).toBeLessThanOrEqual(0);
      expect(expectDefined(first.position)).toBeLessThanOrEqual(expectDefined(second.position));
      expect(first.position === second.position).toBe(first.totalScore === second.totalScore);

      const settled = await getFunctionalPrisma().contestEntryStanding.findMany({ where: { contestId } });
      expect(Object.fromEntries(settled.map((standing) => [standing.contestEntryId, standing.totalScore])))
        .toEqual(Object.fromEntries(board.entries.map((entry) => [entry.entryId, entry.totalScore])));
    },
    60_000,
  );
});
