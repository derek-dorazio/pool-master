import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acceptInvitation,
  createContest,
  enterContest,
  generateInviteLink,
  getContest,
  getContestLeaderboard,
  getGamePicks,
  listContestConfigTemplates,
  listEventParticipants,
  listEventRounds,
  listEvents,
  listSportLeagues,
  openContest,
  runContestDraw,
  saveGamePicks,
  submitGamePicks,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, PredictedResult, SelectionType, Sport } from '@poolmaster/shared/domain';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { EVERY_GAME_PLAYED } from '../support/sport-test-seed';
import { sportRowKeys } from '../support/sport-rows';
import { unlinkContestsFromSportEvents } from '../support/contest-event-links';
import { AWAY_SIDE, HOME_SIDE } from '../support/match-sides';
import { rowSideTeam } from '../support/match-rows';

// NCAA Men's Football's bowl games end to end over HTTP (#2154): two played bowls load into the
// league's BOWLS slot as one event of one round, a game each. A commissioner runs the bowls'
// seeded templates on it: a pick'em straight up that scores a point for each right pick, squares
// on one bowl game, and a sweepstakes where a dealt team's bowl win scores 1.

const RUN = `bowls-${Date.now()}`;
const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');

/** Two bowls, made up from the CFP seed's teams: Alabama beats Oklahoma, and Miami beats Texas A&M. */
const BOWLS = [
  { away: 'alabama-crimson-tide', home: 'oklahoma-sooners', awayScore: 34, homeScore: 24, at: '2025-12-20T01:00:00Z' },
  { away: 'miami-hurricanes', home: 'texas-am-aggies', awayScore: 10, homeScore: 3, at: '2025-12-20T17:00:00Z' },
] as const;
const WINNERS = ['Alabama Crimson Tide', 'Miami Hurricanes'];

const created = { sportEventIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  const runParticipantIds = (await db.sportEventParticipant.findMany({ where: { sportEventId: { in: eventIds } }, select: { participantId: true } }))
    .map((row) => row.participantId);
  if (eventIds.length) {
    await db.contestEntryMatchPrediction.deleteMany({ where: { sportEventRoundMatch: { sportEventId: { in: eventIds } } } });
    await db.contestEntryPick.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await unlinkContestsFromSportEvents(db, eventIds);
    await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  await db.participant.deleteMany({ where: { id: { in: runParticipantIds }, sportEventParticipants: { none: {} } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/**
 * The bowls as a test seed: the CFP seed's file and teams, its one event replaced by the two
 * bowls on the BOWLS slot, every key tagged with this run so they never meet another suite's.
 */
function bowlsSeed(): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, 'american-football-2025-cfp-test.json'), 'utf8')) as unknown);
  const [league] = file.sportLeagues;
  const [playoffs] = league.events;
  const tagged = (key: string) => `${RUN}-cfp-${key}`;
  const keys = new Set(BOWLS.flatMap((bowl) => [`cfp-${bowl.away}`, `cfp-${bowl.home}`]));
  league.players = league.players.filter((player) => keys.has(player.key)).map((player) => ({ ...player, key: `${RUN}-${player.key}` }));
  const field = playoffs.field
    .filter((entry) => keys.has(entry.player))
    .map(({ seed: _seed, ...entry }) => ({ ...entry, player: `${RUN}-${entry.player}` }));
  league.events = [{
    ...playoffs,
    key: 'bowls-2025-26',
    roundSlotKeys: undefined,
    slotKey: 'BOWLS',
    name: `Bowl Games ${RUN}`,
    startDate: '2025-12-19',
    endDate: '2025-12-20',
    rounds: 1,
    field,
    matches: BOWLS.map((bowl, index) => ({
      matchNumber: index + 1,
      roundNumber: 1,
      sides: [
        { sideNumber: 1, player: tagged(bowl.away), homeAway: 'AWAY' as const },
        { sideNumber: 2, player: tagged(bowl.home), homeAway: 'HOME' as const },
      ],
      isNeutralSite: false,
      scheduledAt: bowl.at,
      advancesTo: null,
      result: { winnerSideNumber: 1, sides: [{ sideNumber: 1, score: bowl.awayScore }, { sideNumber: 2, score: bowl.homeScore }] },
    })),
  }];
  return file;
}

/** Loads the bowls dated from today (release refuses an event that has started), and finds their event. */
async function loadBowls(admin: RegisteredUserContext) {
  const file = bowlsSeed();
  await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.APPLY, resultsThrough: EVERY_GAME_PLAYED });
  const leagueName = file.sportLeagues[0].name;
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: admin.client, query: { sport: Sport.FOOTBALL } })).data).sportLeagues
    .find((league) => league.name === leagueName), leagueName);
  const eventName = file.sportLeagues[0].events[0].name;
  const event = expectDefined(expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId: sportLeague.id } })).data).events
    .find((row) => row.name === eventName), eventName);
  created.sportEventIds.add(event.id);
  return { sportLeague, event };
}

describe('SDK Functional: bowl games (#2154)', () => {
  beforeAll(async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.FOOTBALL },
      create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL) },
      update: {},
    });
  });

  it('runs the bowls\' seeded pick\'em, squares on one bowl game and sweepstakes on the bowls event, the pick\'em settling a point a right pick and the sweepstakes a point for a dealt team\'s bowl win', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Bowl Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const { sportLeague, event } = await loadBowls(admin);
    // One round, played in the BOWLS slot, a TOURNAMENT slot of single games.
    expect(expectDefined((await listEventRounds({ client: a, path: { eventId: event.id } })).data).rounds.map((round) => round.slot.slotKind)).toEqual(['TOURNAMENT']);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    const nameOf = (rowId: string) => expectDefined(field.find((row) => row.id === rowId), rowId).participant.name;

    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Bowl Commissioner', leagueName: `Bowl Season ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Bowl Member' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });

    const templates = expectDefined((await listContestConfigTemplates({ client: commissioner.client, query: { sportLeagueId: sportLeague.id, active: true } })).data).templates;
    const template = (key: string) => expectDefined(templates.find((row) => row.templateKey === key), key);

    // --- Pick'em straight up -------------------------------------------------------------------------
    const pickEmTemplate = template('bowls-pick-em-straight-up');
    expect(pickEmTemplate.isDefault).toBe(true);
    const pickEm = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Bowl Pick'em ${RUN}`, sportEventIds: [event.id], contestFormat: ContestFormat.PREDICTION, selectionType: SelectionType.PICK_EM, templateId: pickEmTemplate.id },
    });
    expect(pickEm.response?.status).toBe(201);
    const pickEmId = expectDefined(pickEm.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId: pickEmId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const pickEmEntryId = expectDefined((await enterContest({ client: member.client, path: { contestId: pickEmId } })).data).entry.id;
    const week = { contestId: pickEmId, entryId: pickEmEntryId, sportEventId: event.id };
    const games = expectDefined((await getGamePicks({ client: member.client, path: week })).data).games;
    expect(games.map((game) => game.matchNumber)).toEqual([1, 2]);
    const matches = await getFunctionalPrisma().sportEventRoundMatch.findMany({ where: { sportEventId: event.id }, include: { sides: true }, orderBy: { matchNumber: 'asc' } });
    const [bowl1, bowl2] = [expectDefined(matches[0]), expectDefined(matches[1])];
    // Right on the first bowl (Alabama, away), wrong on the second (Texas A&M, home).
    const saved = await saveGamePicks({
      client: member.client,
      path: week,
      body: {
        picks: [
          { sportEventRoundMatchId: bowl1.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(rowSideTeam(bowl1, AWAY_SIDE)), confidence: null },
          { sportEventRoundMatchId: bowl2.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: expectDefined(rowSideTeam(bowl2, HOME_SIDE)), confidence: null },
        ],
        tiebreakerValue: 20,
      },
    });
    expect(saved.data?.canSubmit).toBe(true);
    expect((await submitGamePicks({ client: member.client, path: week })).response?.status).toBe(200);

    // --- Squares on one bowl game --------------------------------------------------------------------
    const squares = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: {
        name: `Bowl Squares ${RUN}`,
        sportEventIds: [event.id],
        sportEventRoundMatchId: bowl1.id,
        contestFormat: ContestFormat.SQUARES,
        selectionType: SelectionType.SQUARES,
        templateId: template('bowls-squares').id,
      },
    });
    expect(squares.response?.status).toBe(201);

    // --- Sweepstakes: one bowl team each -------------------------------------------------------------
    const sweepstakes = await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Bowl Sweepstakes ${RUN}`, sportEventIds: [event.id], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.RANDOM_DRAW, templateId: template('bowls-random-draw-straight-up').id },
    });
    expect(sweepstakes.response?.status).toBe(201);
    const sweepstakesId = expectDefined(sweepstakes.data).contest.id;
    expect((await openContest({ client: commissioner.client, path: { id: league.id, contestId: sweepstakesId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    await enterContest({ client: commissioner.client, path: { contestId: sweepstakesId } });
    await enterContest({ client: member.client, path: { contestId: sweepstakesId } });
    expect((await runContestDraw({ client: commissioner.client, path: { contestId: sweepstakesId } })).data?.entries.map((entry) => entry.status)).toEqual(['SUBMITTED', 'SUBMITTED']);

    // --- Kickoff, then settled -----------------------------------------------------------------------
    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'IN_PROGRESS' } })).data?.event.status).toBe('IN_PROGRESS');
    const board = expectDefined((await getContestLeaderboard({ client: member.client, path: { contestId: sweepstakesId } })).data);
    const dealt = board.entries.flatMap((entry) => entry.picks).map((pick) => ({ name: nameOf(pick.sportEventParticipantId), points: pick.knockout?.points }));
    expect(dealt).toHaveLength(2);
    expect(dealt).toEqual(dealt.map(({ name }) => ({ name, points: WINNERS.includes(name) ? 1 : 0 })));

    expect((await transitionEvent({ client: a, path: { eventId: event.id }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
    expect(expectDefined((await getContest({ client: member.client, path: { contestId: pickEmId } })).data).contest.status).toBe(ContestStatus.COMPLETED);
    const settled = await getFunctionalPrisma().contestEntryStanding.findUniqueOrThrow({ where: { contestEntryId: pickEmEntryId } });
    expect(settled.totalScore).toBe(1);
  });
});
