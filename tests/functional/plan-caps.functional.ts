import {
  acceptInvitation,
  addEventParticipants,
  applyEventParticipantUpload,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createContest,
  createEvent,
  createParticipant,
  enterContest,
  generateInviteLink,
  getLeaguePlanUsage,
  getSettingsGroup,
  listContestConfigTemplates,
  listSportLeagues,
  listSportLeaguesUsed,
  listSports,
  releaseEvent,
  resetSettingsGroup,
  updateLeaguePlan,
  updateSettingsGroup,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, LeaguePlan, SelectionType, Sport, findSportRow } from '@poolmaster/shared/domain';
import { LeaguePlanUsageResponseSchema, SportLeaguesUsedResponseSchema } from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, seedContestFixture } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';

// A plan's caps end to end (#947). With Free's sports leagues a year saved as one, a league's 2099
// contests may be in one sports league: its first men's Majors contest is made, a women's one is
// refused, and a second men's one is made. The plan settings go back to their defaults after. A Free contest takes 20 entries and refuses the 21st, which goes in once the league moves
// up to Pro.

const RUN = `plan-caps-${Date.now()}`;
const SEASON = 2099;
const RUNNERS = ['Kiplimo', 'Lemma', 'Kipruto', 'Tola'];

const created = { sportEventIds: new Set<string>(), participantIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.eventSeries.deleteMany({ where: { id: { in: seriesIds } } });
  }
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: plan caps (#947)', () => {
  it('lets a league on a plan with one sports league a year make contests in it, refusing a second with 409 and listing the one used', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Caps Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.RUNNING)).id;
    const runningLeagues = expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.RUNNING } })).data).sportLeagues;
    const majorsMen = expectDefined(runningLeagues.find((league) => league.name === 'World Marathon Majors (men)'));
    const majorsWomen = expectDefined(runningLeagues.find((league) => league.name === 'World Marathon Majors (women)'));
    const runnerIds: string[] = [];
    for (const runner of RUNNERS) {
      const id = expectDefined((await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${runner} ${RUN}` } })).data).participant.id;
      created.participantIds.add(id);
      runnerIds.push(id);
    }

    /** A released race in `sportLeagueId` with the four runners, one to a tier. */
    const releaseRace = async (sportLeagueId: string, name: string, startDate: string) => {
      const eventId = expectDefined((await createEvent({
        client: a,
        body: { sportLeagueId, eventYear: SEASON, name: `${name} ${RUN}`, startDate, autoLifecycleEnabled: false },
      })).data).event.id;
      created.sportEventIds.add(eventId);
      await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: runnerIds } });
      await applyEventParticipantUpload({
        client: a,
        path: { eventId },
        body: { rows: RUNNERS.map((runner, index) => ({ playerName: `${runner} ${RUN}`, ranking: index + 1, seedNumber: index + 1 })) },
      });
      await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'RANKING', tierSize: 1 } });
      await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() });
      expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');
      return eventId;
    };

    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Cap Keeper', leagueName: `Cap Harriers ${RUN}` });
    expect((await updateLeaguePlan({ client: commissioner.client, path: { id: league.id }, body: { plan: LeaguePlan.FREE } })).response.status).toBe(200);
    // Free allows 5 sports leagues a year; two running leagues show the cap with Free saved at one.
    const plans = expectDefined((await getSettingsGroup({ client: a, path: { key: 'PLAN_CONFIG' } })).data);
    if (plans.key !== 'PLAN_CONFIG') throw new Error('Expected the PLAN_CONFIG settings group');
    const saved = await updateSettingsGroup({
      client: a,
      path: { key: 'PLAN_CONFIG' },
      body: {
        key: 'PLAN_CONFIG',
        value: { ...plans.value, caps: { ...plans.value.caps, SPORTS_LEAGUES_PER_YEAR: { ...plans.value.caps.SPORTS_LEAGUES_PER_YEAR, FREE: 1 } } },
        expectedUpdatedAt: plans.updatedAt,
      },
    });
    expect(saved.response.status).toBe(200);
    try {
      const templateFor = async (sportLeagueId: string, templateKey: string) => expectDefined(expectDefined((await listContestConfigTemplates({
        client: commissioner.client,
        query: { sport: Sport.RUNNING, sportLeagueId, active: true },
      })).data).templates.find((template) => template.templateKey === templateKey)).id;
      const menTemplate = await templateFor(majorsMen.id, 'wmm-men-tiered-top-10');
      const womenTemplate = await templateFor(majorsWomen.id, 'wmm-women-tiered-top-10');
      const create = (name: string, eventId: string, templateId: string) => createContest({
        client: commissioner.client,
        path: { id: league.id },
        body: { name: `${name} ${RUN}`, sportEventIds: [eventId], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId },
      });
      const used = async () => SportLeaguesUsedResponseSchema.parse(expectDefined((await listSportLeaguesUsed({
        client: commissioner.client,
        path: { id: league.id },
        query: { seasonYear: SEASON },
      })).data));

      expect(await used()).toEqual({ seasonYear: SEASON, sportLeagueIds: [] });
      const harbour = await releaseRace(majorsMen.id, 'Harbour Marathon', `${SEASON}-04-19T13:30:00.000Z`);
      expect((await create('Harbour Picks', harbour, menTemplate)).response.status).toBe(201);
      expect(await used()).toEqual({ seasonYear: SEASON, sportLeagueIds: [majorsMen.id] });

      const ridge = await releaseRace(majorsWomen.id, 'Ridge Marathon', `${SEASON}-05-03T13:30:00.000Z`);
      const refused = await create('Ridge Picks', ridge, womenTemplate);
      expect(refused.response.status).toBe(409);
      expect(refused.error?.error.code).toBe('PLAN_SPORTS_LEAGUE_LIMIT_REACHED');

      const valley = await releaseRace(majorsMen.id, 'Valley Marathon', `${SEASON}-10-11T13:30:00.000Z`);
      expect((await create('Valley Picks', valley, menTemplate)).response.status).toBe(201);
      expect(await used()).toEqual({ seasonYear: SEASON, sportLeagueIds: [majorsMen.id] });

      // A member may not read the usage; it is the commissioner's Create contest counter.
      const member = await buildRegisteredUser({ displayName: 'Cap Bystander' });
      expect((await listSportLeaguesUsed({ client: member.client, path: { id: league.id }, query: { seasonYear: SEASON } })).response.status).toBe(403);
    } finally {
      await resetSettingsGroup({ client: a, path: { key: 'PLAN_CONFIG' } });
    }
  });

  it('refuses a Free contest\'s 21st entry with 409 CONTEST_FULL and takes it once the league moves up to Pro', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Entry Counter', leagueName: `Full House ${RUN}` });
    await updateLeaguePlan({ client: commissioner.client, path: { id: league.id }, body: { plan: LeaguePlan.FREE } });
    const { contestId } = await seedContestFixture(league.id, {
      name: `Full House Picks ${RUN}`,
      selectionType: SelectionType.TIERED,
      configuration: { maxEntriesPerSquad: 25 },
    });
    const enter = () => enterContest({ client: commissioner.client, path: { contestId } });

    for (let entry = 1; entry <= 20; entry += 1) {
      expect((await enter()).response.status).toBe(201);
    }
    const full = await enter();
    expect(full.response.status).toBe(409);
    expect(full.error?.error.code).toBe('CONTEST_FULL');

    await updateLeaguePlan({ client: commissioner.client, path: { id: league.id }, body: { plan: LeaguePlan.PRO } });
    expect((await enter()).response.status).toBe(201);
  });

  it('shows the commissioner each contest still taking entries with every entry it holds, drafts included, and refuses a league member who is not a commissioner with 403', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Usage Reader', leagueName: `Usage Club ${RUN}` });
    const { contestId } = await seedContestFixture(league.id, {
      name: `Usage Picks ${RUN}`,
      selectionType: SelectionType.TIERED,
      configuration: { maxEntriesPerSquad: 3 },
    });
    await seedContestFixture(league.id, { name: `Usage Draft ${RUN}`, selectionType: SelectionType.TIERED, status: 'DRAFT' });
    for (let entry = 1; entry <= 2; entry += 1) {
      expect((await enterContest({ client: commissioner.client, path: { contestId } })).response.status).toBe(201);
    }

    const usage = LeaguePlanUsageResponseSchema.parse(expectDefined((await getLeaguePlanUsage({
      client: commissioner.client,
      path: { id: league.id },
    })).data));
    // Two draft entries, never submitted, count against the cap the same as submitted ones.
    expect(usage).toEqual({
      seasonYear: new Date().getUTCFullYear(),
      sportLeagueIds: [],
      openContests: [{ contestId, name: `Usage Picks ${RUN}`, entryCount: 2 }],
    });

    // A member of the league, not a commissioner, never sees the plan or what it uses.
    const member = await buildRegisteredUser({ displayName: 'Usage Member' });
    const invite = expectDefined((await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } })).data);
    expect((await acceptInvitation({ client: member.client, body: { inviteCode: invite.invitation.inviteCode } })).data?.membership.userId).toBe(member.userId);
    expect((await getLeaguePlanUsage({ client: member.client, path: { id: league.id } })).response.status).toBe(403);
  });
});
