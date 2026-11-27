import {
  addEventParticipants,
  autoAssignEventSlotPrices,
  autoAssignEventSlotTiers,
  createContest,
  createParticipant,
  getContest,
  listContestConfigTemplates,
  listSportLeagues,
  openContest,
  releaseEvent,
  setContestCoverage,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, ContestStatus, SelectionType, Sport } from '@poolmaster/shared/domain';
import { CONTEST_EVENTS_LOCKED } from '@poolmaster/shared/dto';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin, createTestEvent } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardPricingFor } from './standard-pricing';
import { setFieldRows } from './field-rows';
import { tierSetSlotPath } from './tier-set-slot';

// A contest's event and starting slot change only while it is in Set up (#2014): a commissioner
// who built a draft on the wrong race moves it to the right one, and the contest then covers that
// race's slot; once the contest is open its coverage is fixed, and a change is refused with
// CONTEST_EVENTS_LOCKED, leaving it as it was.

const RUN = `coverage-${Date.now()}`;
const DRIVERS = ['Larson', 'Byron', 'Bell', 'Blaney', 'Elliott', 'Hamlin'];

const created = {
  sportEventIds: new Set<string>(),
  participantIds: new Set<string>(),
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    await db.sportEventSlotParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: eventIds } } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
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

/** A released race in the series with the six drivers ranked, tiered and priced. */
async function releasedRace(client: Client, sportLeagueId: string, driverIds: readonly string[], name: string, startDate: string): Promise<string> {
  const race = await createTestEvent({
    client,
    body: { sportLeagueId, championshipYear: 2099, name: `${name} ${RUN}`, startDate, autoLifecycleEnabled: false },
  });
  expect(race.response?.status).toBe(201);
  const eventId = expectDefined(race.data).event.id;
  created.sportEventIds.add(eventId);
  expect((await addEventParticipants({ client, path: { eventId }, body: { participantIds: [...driverIds] } })).data?.added).toBe(DRIVERS.length);
  const upload = await setFieldRows({
    client,
    path: { eventId },
    body: { rows: DRIVERS.map((driver, index) => ({ playerName: `${driver} ${RUN}`, ranking: index + 1 })) },
  });
  expect(upload.response?.status).toBe(200);
  expect((await autoAssignEventSlotTiers({ client, path: await tierSetSlotPath(client, eventId), body: { tierSize: 1 } })).response?.status).toBe(200);
  expect((await autoAssignEventSlotPrices({ client, path: await tierSetSlotPath(client, eventId), body: await standardPricingFor(client) })).response?.status).toBe(200);
  expect((await releaseEvent({ client, path: { eventId } })).data?.event.status).toBe('SCHEDULED');
  return eventId;
}

describe('SDK Functional: a contest\'s event changes only in Set up', () => {
  it('moves a draft to another race of its Season, covering that race\'s slot, and refuses a change once the contest is open, leaving it as it was', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Race Control' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const series = expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AUTO_RACING } })).data).sportLeagues;
    const nascar = expectDefined(series.find((league) => league.name === 'NASCAR Cup Series'));
    const driverIds: string[] = [];
    for (const driver of DRIVERS) {
      const participant = await createParticipant({ client: a, body: { sportLeagueId: nascar.id, participantType: 'INDIVIDUAL', name: `${driver} ${RUN}` } });
      const id = expectDefined(participant.data).participant.id;
      created.participantIds.add(id);
      driverIds.push(id);
    }
    const wrongRace = await releasedRace(a, nascar.id, driverIds, 'Harbour 400', '2099-02-15T19:30:00.000Z');
    const rightRace = await releasedRace(a, nascar.id, driverIds, 'Valley 500', '2099-02-22T19:30:00.000Z');

    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Crew Chief', leagueName: `Pit Row ${RUN}` });
    const c = commissioner.client;
    const template = expectDefined(expectDefined((await listContestConfigTemplates({
      client: c,
      query: { sportLeagueId: nascar.id, active: true },
    })).data).templates.find((candidate) => candidate.isDefault && candidate.contestFormat === ContestFormat.ROSTER));
    const draft = await createContest({
      client: c,
      path: { id: league.id },
      body: {
        name: `Wrong race ${RUN}`,
        sportEventIds: [wrongRace],
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        templateId: template.id,
      },
    });
    expect(draft.response?.status).toBe(201);
    const contestId = expectDefined(draft.data).contest.id;
    const coverageOf = async () => expectDefined((await getContest({ client: c, path: { contestId } })).data).contest.coveredSlots
      .map((slot) => slot.sportEventId);
    expect(await coverageOf()).toEqual([wrongRace]);

    // In Set up, the commissioner moves the draft to the right race: it now covers that race's slot.
    const moved = await setContestCoverage({ client: c, path: { id: league.id, contestId }, body: { sportEventIds: [rightRace] } });
    expect(moved.response?.status).toBe(200);
    expect(expectDefined(moved.data).contest.sportEvents.map((sportEvent) => sportEvent.sportEventId)).toEqual([rightRace]);
    expect(await coverageOf()).toEqual([rightRace]);

    // Once open, its coverage is fixed: a change is refused and the contest still covers the right race.
    expect((await openContest({ client: c, path: { id: league.id, contestId } })).data?.contest.status).toBe(ContestStatus.OPEN);
    const refused = await setContestCoverage({ client: c, path: { id: league.id, contestId }, body: { sportEventIds: [wrongRace] } });
    expect(refused.response?.status).toBe(409);
    expect(refused.error).toMatchObject({ error: { code: CONTEST_EVENTS_LOCKED } });
    expect(await coverageOf()).toEqual([rightRace]);
  });
});
