import { randomUUID } from 'node:crypto';
import { ProviderSyncFindingAction, ProviderSyncFindingKind, ProviderSyncFindingSeverity, ProviderSyncFindingStatus } from '@poolmaster/shared/domain';
import { linkProviderSyncFindingSlot, listProviderSyncFindingSlotChoices } from '@poolmaster/shared/generated/hey-api';
import { deleteTestSportLeagues } from '../support/test-slots';
import { sportLeagueRowDefaults } from '../support/league-profiles';
import { syncLeagueTo, syncSeasonsTo } from '../support/league-sync';
import { nameSlotDefinitionFor } from '../support/sync-slots';
import { sportRowKeys } from '../support/sport-rows';
import { sportPlay } from '../support/sport-play';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, expectFunctionalError, getFunctionalPrisma } from './setup';

// "Link to existing" on a tournament name the events sync matched to no slot (#2011): a root admin
// picks one of the league's name-matched slots, which adds the finding's name as that slot's
// pattern and resolves the finding, so the next sync links the tournament. Through the SDK.

const createdSportLeagueIds: string[] = [];

afterEach(async () => {
  await deleteTestSportLeagues(getFunctionalPrisma(), createdSportLeagueIds.splice(0));
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

/**
 * A golf tour synced from BALLDONTLIE's PGA TOUR with a name-matched Memorial slot, and the OPEN
 * SLOT_NAME_UNMATCHED finding the sync raises for a tournament no pattern names.
 */
async function unmatchedTournament() {
  const database = getFunctionalPrisma();
  const sport = await database.sport.upsert({
    where: { sport: 'GOLF' },
    create: { sport: 'GOLF', ...sportRowKeys('GOLF'), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const tour = await database.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(database)), ...sportPlay(sport.sport), sportId: sport.id, name: `FAPI Name Tour ${randomUUID()}` } });
  createdSportLeagueIds.push(tour.id);
  const sportLeagueProviderMappingId = await syncLeagueTo(database, tour.id, 'pga');
  const [seasonId] = await syncSeasonsTo(database, tour.id, sportLeagueProviderMappingId, [2027]);
  const slotDefinitionId = await nameSlotDefinitionFor(database, { sportLeagueId: tour.id, sportLeagueProviderMappingId, pattern: 'the memorial tournament', seasonIds: [seasonId], covered: false });
  const provider = await database.provider.findFirstOrThrow({ where: { code: 'BALLDONTLIE' }, select: { id: true } });
  const now = new Date();
  const finding = await database.providerSyncFinding.create({
    data: {
      kind: ProviderSyncFindingKind.SLOT_NAME_UNMATCHED,
      severity: ProviderSyncFindingSeverity.INFO,
      sportLeagueId: tour.id,
      providerId: provider.id,
      providerValue: 'memorial tournament',
      providerValueName: 'Memorial Tournament presented by Workday 2027',
      firstSeenAt: now,
      lastSeenAt: now,
      statusChangedAt: now,
    },
  });
  return { sportLeagueProviderMappingId, slotDefinitionId, findingId: finding.id };
}

describe('SDK Functional: linking a tournament name to an existing slot', () => {
  it('offers the league\'s name-matched slots, adds the name as the chosen slot\'s pattern and resolves the finding; linking again is 409', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Slot Link Root Admin' });
    await promoteToRootAdmin(admin);
    const { sportLeagueProviderMappingId, slotDefinitionId, findingId } = await unmatchedTournament();

    const choices = await listProviderSyncFindingSlotChoices({ client: admin.client, path: { findingId } });
    const linked = await linkProviderSyncFindingSlot({ client: admin.client, path: { findingId }, body: { slotDefinitionId } });
    const again = await linkProviderSyncFindingSlot({ client: admin.client, path: { findingId }, body: { slotDefinitionId } });

    expect(choices.data?.slots).toEqual([expect.objectContaining({ slotDefinitionId, slotKind: 'TOURNAMENT', patterns: ['the memorial tournament'] })]);
    expect(linked.data?.finding).toMatchObject({ id: findingId, status: ProviderSyncFindingStatus.RESOLVED, actions: [ProviderSyncFindingAction.REOPEN] });
    expect(await getFunctionalPrisma().sportLeagueCompetitionSlotProviderMapping.findMany({
      where: { sportLeagueCompetitionSlotId: slotDefinitionId, sportLeagueProviderMappingId },
      select: { matchType: true, providerValue: true },
      orderBy: { providerValue: 'asc' },
    })).toEqual([{ matchType: 'NAME_PATTERN', providerValue: 'memorial tournament' }, { matchType: 'NAME_PATTERN', providerValue: 'the memorial tournament' }]);
    expectFunctionalError(again, { status: 409, code: 'SYNC_FINDING_ACTION_NOT_OFFERED' });
  });

  it('refuses a slot the finding does not offer with 404 and a member with 403, adding no pattern', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Slot Link Root Admin' });
    await promoteToRootAdmin(admin);
    const member = await buildRegisteredUser({ displayName: 'Slot Link Member' });
    const { slotDefinitionId, findingId } = await unmatchedTournament();

    const unknown = await linkProviderSyncFindingSlot({ client: admin.client, path: { findingId }, body: { slotDefinitionId: randomUUID() } });
    const refused = await linkProviderSyncFindingSlot({ client: member.client, path: { findingId }, body: { slotDefinitionId } });

    expectFunctionalError(unknown, { status: 404, code: 'SLOT_DEFINITION_NOT_FOUND' });
    expectFunctionalError(refused, { status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' });
    expect(await getFunctionalPrisma().sportLeagueCompetitionSlotProviderMapping.count({ where: { sportLeagueCompetitionSlotId: slotDefinitionId } })).toBe(1);
    expect((await getFunctionalPrisma().providerSyncFinding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe(ProviderSyncFindingStatus.OPEN);
  });
});
