/**
 * Sync findings (#1999) against real Postgres: one row per kind and subject however often the sync
 * raises it, what a raise does to a resolved or waived finding, the retention cleanup, the startup
 * webhook check, and the root admin's routes over them. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ProviderCode,
  ProviderSyncFindingAction,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
  Sport,
  type ProviderSyncFindingRaise,
} from '@poolmaster/shared/domain';
import {
  ErrorEnvelopeSchema,
  ProviderSyncFindingListResponseSchema,
  ProviderSyncFindingResponseSchema,
  SportLeagueOverviewListResponseSchema,
} from '@poolmaster/shared/dto';
import { PrismaParticipantProviderMappingRepository, PrismaParticipantRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { PrismaProviderSettingsRepository } from '../../../packages/core-api/src/adapters/prisma-provider-settings-repository';
import { PrismaProviderSyncFindingRepository } from '../../../packages/core-api/src/adapters/prisma-provider-sync-finding-repository';
import { ProviderRateLimitWatch } from '../../../packages/core-api/src/modules/ingestion/findings/provider-rate-limit-watch';
import { ProviderSyncFindingService } from '../../../packages/core-api/src/modules/ingestion/findings/provider-sync-finding-service';
import { ProviderSettingsStore } from '../../../packages/core-api/src/modules/ingestion/provider-settings-store';
import { SYNC_FINDINGS_REQUESTS_PER_MINUTE } from '../../../packages/core-api/src/modules/ingestion/findings/routes';
import { SyncFindingRetention } from '../../../packages/core-api/src/modules/ingestion/findings/sync-finding-retention';
import { ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import { cleanupTestData, createTestUser, getApp, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const NOW = new Date('2027-04-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

async function golfLeague(): Promise<{ id: string; name: string }> {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  return prisma.sportLeague.create({
    data: { ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Findings Tour ${randomUUID().slice(0, 8)}` },
    select: { id: true, name: true },
  });
}

async function balldontlie() {
  return getPrisma().provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE } });
}

function unmapped(sportLeagueId: string, providerId: string, externalId: string, severity: ProviderSyncFindingRaise['severity'] = ProviderSyncFindingSeverity.WARNING): ProviderSyncFindingRaise {
  return {
    kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT,
    severity,
    sportLeagueId,
    sportEventId: null,
    providerId,
    providerValue: externalId,
    providerValueName: null,
  };
}

describe('the sync findings table', () => {
  const repository = () => new PrismaProviderSyncFindingRepository(getPrisma());

  it('keeps one row per kind and subject: a second raise counts the sighting and takes the new severity, and opens nothing new', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();

    const first = await repository().raise([unmapped(league.id, provider.id, 'g-1'), unmapped(league.id, provider.id, 'g-1')], NOW);
    const second = await repository().raise([unmapped(league.id, provider.id, 'g-1', ProviderSyncFindingSeverity.ERROR)], new Date(NOW.getTime() + 60_000));

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    const rows = await getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seenCount: 2, severity: ProviderSyncFindingSeverity.ERROR, status: ProviderSyncFindingStatus.OPEN, firstSeenAt: NOW });
  });

  it('refuses a second row for a subject with no event or value, as the NULLS NOT DISTINCT unique index says', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();
    const data = {
      kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING,
      severity: ProviderSyncFindingSeverity.ERROR,
      sportLeagueId: league.id,
      providerId: provider.id,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      statusChangedAt: NOW,
    };
    await getPrisma().providerSyncFinding.create({ data });

    await expect(getPrisma().providerSyncFinding.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('opens a resolved finding again when the sync sees it again, and leaves a waived one waived', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();
    const [resolved, waived] = await repository().raise([unmapped(league.id, provider.id, 'g-r'), unmapped(league.id, provider.id, 'g-w')], NOW);
    await getPrisma().providerSyncFinding.update({ where: { id: resolved.id }, data: { status: ProviderSyncFindingStatus.RESOLVED } });
    await getPrisma().providerSyncFinding.update({ where: { id: waived.id }, data: { status: ProviderSyncFindingStatus.WAIVED, waiveNote: 'Amateur, never scored' } });

    const opened = await repository().raise([unmapped(league.id, provider.id, 'g-r'), unmapped(league.id, provider.id, 'g-w')], NOW);

    expect(opened.map((finding) => finding.id)).toEqual([resolved.id]);
    const statuses = await getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id }, select: { id: true, status: true, waiveNote: true } });
    expect(statuses).toEqual(expect.arrayContaining([
      { id: resolved.id, status: ProviderSyncFindingStatus.OPEN, waiveNote: null },
      { id: waived.id, status: ProviderSyncFindingStatus.WAIVED, waiveNote: 'Amateur, never scored' },
    ]));
  });

  it('resolves one event\'s open finding of a kind, leaving the same kind on another event open', async () => {
    const prisma = getPrisma();
    const provider = await balldontlie();
    // One edition per event: a series has one event a year.
    const event = async (name: string) => prisma.sportEvent.create({
      data: { ...(await freshEventEdition(prisma)), externalId: `findings-${randomUUID()}`, providerId: 'integration-test', name, startDate: NOW },
      select: { id: true, eventSeries: { select: { sportLeagueId: true } } },
    });
    const [week1, week2] = [await event('Week 1'), await event('Week 2')];
    const { sportLeagueId } = week1.eventSeries;
    const noField = (sportEventId: string): ProviderSyncFindingRaise => ({
      kind: ProviderSyncFindingKind.NO_PROVIDER_PARTICIPANTS, severity: ProviderSyncFindingSeverity.WARNING, sportLeagueId, sportEventId, providerId: provider.id, providerValue: null, providerValueName: null,
    });
    await repository().raise([noField(week1.id), noField(week2.id)], NOW);

    const resolved = await repository().resolveOpen({ kind: ProviderSyncFindingKind.NO_PROVIDER_PARTICIPANTS, sportLeagueId, sportEventId: week1.id, providerId: provider.id }, NOW);

    expect(resolved).toBe(1);
    const statuses = await prisma.providerSyncFinding.findMany({ where: { sportLeagueId, kind: ProviderSyncFindingKind.NO_PROVIDER_PARTICIPANTS }, select: { sportEventId: true, status: true } });
    expect(statuses).toEqual(expect.arrayContaining([
      { sportEventId: week1.id, status: ProviderSyncFindingStatus.RESOLVED },
      { sportEventId: week2.id, status: ProviderSyncFindingStatus.OPEN },
    ]));
  });

  it('refuses a waived finding with no note, as its check constraint says', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();
    const [finding] = await repository().raise([unmapped(league.id, provider.id, 'g-1')], NOW);

    await expect(getPrisma().providerSyncFinding.update({ where: { id: finding.id }, data: { status: ProviderSyncFindingStatus.WAIVED, waiveNote: '  ' } }))
      .rejects.toThrow(/provider_sync_findings_waive_note_required/);
  });

  it('the nightly cleanup deletes findings resolved over 90 days ago, and keeps newer resolved, open and waived ones however old', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();
    const old = new Date(NOW.getTime() - 91 * DAY_MS);
    const raised = await repository().raise(['old-resolved', 'new-resolved', 'old-open', 'old-waived'].map((id) => unmapped(league.id, provider.id, id)), old);
    const [oldResolved, newResolved, oldOpen, oldWaived] = raised;
    await getPrisma().providerSyncFinding.update({ where: { id: oldResolved.id }, data: { status: ProviderSyncFindingStatus.RESOLVED, statusChangedAt: old } });
    await getPrisma().providerSyncFinding.update({ where: { id: newResolved.id }, data: { status: ProviderSyncFindingStatus.RESOLVED, statusChangedAt: new Date(NOW.getTime() - DAY_MS) } });
    await getPrisma().providerSyncFinding.update({ where: { id: oldWaived.id }, data: { status: ProviderSyncFindingStatus.WAIVED, waiveNote: 'Known', statusChangedAt: old } });

    const deleted = await new SyncFindingRetention(repository()).purge(NOW);

    expect(deleted).toBe(1);
    const kept = await getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id }, select: { id: true } });
    expect(kept.map((row) => row.id).sort()).toEqual([newResolved.id, oldOpen.id, oldWaived.id].sort());
  });
});

/**
 * The app's client with one interruption: on the first raise only, another writer adds `conflict`
 * between the raise's read and its insert, as a second sync task can.
 */
function clientRacedOnce(conflict: () => Promise<unknown>): PrismaClient {
  const prisma = getPrisma();
  let raced = false;
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver) as unknown;
      return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction((tx) => run(new Proxy(tx, {
        get(txTarget, txProperty, txReceiver) {
          if (txProperty !== 'providerSyncFinding') return Reflect.get(txTarget, txProperty, txReceiver) as unknown;
          return new Proxy(txTarget.providerSyncFinding, {
            get(table, method, tableReceiver) {
              const original = Reflect.get(table, method, tableReceiver) as unknown;
              if (method !== 'createManyAndReturn' || raced || typeof original !== 'function') return original;
              return async (...args: unknown[]) => {
                raced = true;
                await conflict();
                return (original as (...callArgs: unknown[]) => Promise<unknown>).apply(table, args);
              };
            },
          });
        },
      })));
    },
  });
}

describe('the sync findings table, edge cases', () => {
  it('tries a raise once more when another writer adds the same subject first, and counts the sighting on that row', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();
    const racer = clientRacedOnce(() => new PrismaProviderSyncFindingRepository(getPrisma()).raise([unmapped(league.id, provider.id, 'g-race')], NOW));

    const opened = await new PrismaProviderSyncFindingRepository(racer).raise([unmapped(league.id, provider.id, 'g-race')], NOW);

    expect(opened).toEqual([]);
    const rows = await getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id } });
    expect(rows).toEqual([expect.objectContaining({ providerValue: 'g-race', seenCount: 2, status: ProviderSyncFindingStatus.OPEN })]);
  });

  it('passes on a failure that is not a duplicate subject, without trying again', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();
    const racer = clientRacedOnce(() => Promise.reject(new Error('connection reset')));

    await expect(new PrismaProviderSyncFindingRepository(racer).raise([unmapped(league.id, provider.id, 'g-x')], NOW)).rejects.toThrow('connection reset');
    await expect(getPrisma().providerSyncFinding.count({ where: { sportLeagueId: league.id } })).resolves.toBe(0);
  });

  it('raises nothing for no findings, and deletes nothing when no finding is old enough', async () => {
    const repository = new PrismaProviderSyncFindingRepository(getPrisma());

    await expect(repository.raise([], NOW)).resolves.toEqual([]);
    await expect(repository.deleteResolvedBatchBefore(NOW, 10)).resolves.toBe(0);
  });

  it('answers null for a status change on a finding that is gone, and passes on any other failure', async () => {
    const league = await golfLeague();
    const provider = await balldontlie();
    const repository = new PrismaProviderSyncFindingRepository(getPrisma());
    const [finding] = await repository.raise([unmapped(league.id, provider.id, 'g-1')], NOW);
    const change = { status: ProviderSyncFindingStatus.RESOLVED, waiveNote: null, changedAt: NOW };

    await expect(repository.setStatus(randomUUID(), { ...change, changedByUserId: (await createTestUser({ isRootAdmin: true })).user.id })).resolves.toBeNull();
    // An admin with no account is a foreign key failure, not a missing finding.
    await expect(repository.setStatus(finding.id, { ...change, changedByUserId: randomUUID() })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the startup webhook check', () => {
  it('raises an ERROR on each league a Provider syncs while its webhooks are on without a secret, and resolves them once the secret is set', async () => {
    const league = await golfLeague();
    await syncLeagueTo(getPrisma(), league.id, 'pga');
    const provider = await balldontlie();
    const synced = await getPrisma().sportLeague.findMany({ where: { id: league.id }, select: { id: true } });
    const service = new ProviderSyncFindingService({
      repository: new PrismaProviderSyncFindingRepository(getPrisma()),
      providers: { all: () => [{ ...provider, leagues: [] }] },
      participants: new ParticipantService(new PrismaParticipantRepository(getPrisma()), new PrismaParticipantProviderMappingRepository(getPrisma())),
      now: () => NOW,
    });
    const syncedLeagues = synced.map(({ id }) => ({ id, selectedProviderMapping: { providerCode: ProviderCode.BALLDONTLIE } as never }));

    await service.checkWebhookSecrets({ syncedLeagues, isMissingSecret: () => true });
    const raised = await getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id } });
    await service.checkWebhookSecrets({ syncedLeagues, isMissingSecret: () => false });
    const after = await getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id } });

    expect(raised).toEqual([expect.objectContaining({ kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, severity: ProviderSyncFindingSeverity.ERROR, providerId: provider.id, status: ProviderSyncFindingStatus.OPEN })]);
    expect(after.map((row) => row.status)).toEqual([ProviderSyncFindingStatus.RESOLVED]);
  });
});

describe('the rate-limit finding', () => {
  it('raises a WARNING on a league a rate-limiting Provider syncs, escalates it to ERROR at the league\'s quiet threshold on the same row, and resolves it at the Provider\'s next answer', async () => {
    const league = await golfLeague();
    await syncLeagueTo(getPrisma(), league.id, 'pga');
    const provider = await balldontlie();
    const providers = new ProviderSettingsStore(new PrismaProviderSettingsRepository(getPrisma()));
    await providers.load();
    const pgaQuietMinutes = providers.enabledLeagues(ProviderCode.BALLDONTLIE).find((each) => each.code === 'pga')?.quietAfterMinutes ?? 0;
    let clock = NOW.getTime();
    const watch = new ProviderRateLimitWatch({
      findings: new ProviderSyncFindingService({
        repository: new PrismaProviderSyncFindingRepository(getPrisma()),
        providers,
        participants: new ParticipantService(new PrismaParticipantRepository(getPrisma()), new PrismaParticipantProviderMappingRepository(getPrisma())),
        now: () => new Date(clock),
      }),
      providers,
      syncedLeagues: async () => (await new PrismaSportLeagueRepository(getPrisma()).findEventSynced()).filter((each) => each.id === league.id),
      now: () => clock,
    });
    const observer = watch.observerFor(ProviderCode.BALLDONTLIE);
    const findings = () => getPrisma().providerSyncFinding.findMany({ where: { sportLeagueId: league.id } });
    const at = async (minutes: number, ending: 'refused' | 'answered') => {
      clock = NOW.getTime() + minutes * 60_000;
      observer[ending]();
      await watch.settled();
    };

    await at(0, 'answered');
    await at(1, 'refused');
    await at(16, 'refused');
    const warned = await findings();
    await at(1 + pgaQuietMinutes, 'refused');
    const escalated = await findings();
    await at(2 + pgaQuietMinutes, 'answered');
    const after = await findings();

    expect(pgaQuietMinutes).toBeGreaterThan(15);
    expect(warned).toEqual([expect.objectContaining({ kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED, severity: ProviderSyncFindingSeverity.WARNING, providerId: provider.id, status: ProviderSyncFindingStatus.OPEN })]);
    expect(escalated).toEqual([expect.objectContaining({ id: warned[0]?.id, severity: ProviderSyncFindingSeverity.ERROR, status: ProviderSyncFindingStatus.OPEN })]);
    expect(after).toEqual([expect.objectContaining({ id: warned[0]?.id, status: ProviderSyncFindingStatus.RESOLVED })]);
  });
});

describe('the sync findings routes (contract)', () => {
  async function seedUnmappedFinding() {
    const league = await golfLeague();
    const provider = await balldontlie();
    const [finding] = await new PrismaProviderSyncFindingRepository(getPrisma()).raise([{ ...unmapped(league.id, provider.id, `golfer-${randomUUID().slice(0, 6)}`), providerValueName: 'Avery Hart' }], NOW);
    return { league, provider, findingId: finding.id };
  }

  it('lists a finding with its league, Provider and offered actions, and answers one by id; an unknown id is 404 SYNC_FINDING_NOT_FOUND and a member is refused', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const member = await createTestUser({});
    const { league, provider, findingId } = await seedUnmappedFinding();

    const listRes = await getApp().inject({ method: 'GET', url: '/api/v1/ingestion/sync-findings', headers: rootAdmin.headers });
    const oneRes = await getApp().inject({ method: 'GET', url: `/api/v1/ingestion/sync-findings/${findingId}`, headers: rootAdmin.headers });
    const missingRes = await getApp().inject({ method: 'GET', url: `/api/v1/ingestion/sync-findings/${randomUUID()}`, headers: rootAdmin.headers });
    const memberRes = await getApp().inject({ method: 'GET', url: '/api/v1/ingestion/sync-findings', headers: member.headers });

    expect(listRes.statusCode).toBe(200);
    const listed = ProviderSyncFindingListResponseSchema.parse(listRes.json()).findings.find((finding) => finding.id === findingId);
    expect(listed).toMatchObject({
      kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT,
      status: ProviderSyncFindingStatus.OPEN,
      sportLeague: { id: league.id, name: league.name, sport: Sport.GOLF },
      provider: { id: provider.id, name: provider.name },
      providerValueName: 'Avery Hart',
      statusChangedBy: null,
      actions: [ProviderSyncFindingAction.MAP_PARTICIPANT, ProviderSyncFindingAction.RESOLVE, ProviderSyncFindingAction.WAIVE],
    });
    expect(ProviderSyncFindingResponseSchema.parse(oneRes.json()).finding).toEqual(listed);
    expect(missingRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(missingRes.json()).error.code).toBe('SYNC_FINDING_NOT_FOUND');
    expect(memberRes.statusCode).toBe(403);
  });

  it('waives only with a note, names the admin who did, offers only Reopen after, and refuses an action not offered with 409', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true, firstName: 'Robin', lastName: 'Admin' });
    const { findingId } = await seedUnmappedFinding();
    const post = (payload: Record<string, unknown>) => getApp().inject({ method: 'POST', url: `/api/v1/ingestion/sync-findings/${findingId}/status`, headers: rootAdmin.headers, payload });

    const noNoteRes = await post({ action: 'WAIVE', waiveNote: '   ' });
    const waivedRes = await post({ action: 'WAIVE', waiveNote: 'An amateur the feed lists; never scored' });
    const resolveRes = await post({ action: 'RESOLVE' });
    const reopenedRes = await post({ action: 'REOPEN' });

    expect(noNoteRes.statusCode).toBe(422);
    expect(ErrorEnvelopeSchema.parse(noNoteRes.json()).error.code).toBe('SYNC_FINDING_WAIVE_NOTE_REQUIRED');
    expect(ProviderSyncFindingResponseSchema.parse(waivedRes.json()).finding).toMatchObject({
      status: ProviderSyncFindingStatus.WAIVED,
      waiveNote: 'An amateur the feed lists; never scored',
      statusChangedBy: { id: rootAdmin.user.id, displayName: 'Robin Admin' },
      actions: [ProviderSyncFindingAction.REOPEN],
    });
    expect(resolveRes.statusCode).toBe(409);
    expect(ErrorEnvelopeSchema.parse(resolveRes.json()).error.code).toBe('SYNC_FINDING_ACTION_NOT_OFFERED');
    expect(ProviderSyncFindingResponseSchema.parse(reopenedRes.json()).finding).toMatchObject({ status: ProviderSyncFindingStatus.OPEN, waiveNote: null });
  });

  it('maps an unmapped participant finding to a participant of its league, which binds the feed id and resolves it; a participant of another league is 422', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const { league, provider, findingId } = await seedUnmappedFinding();
    const other = await golfLeague();
    const prisma = getPrisma();
    const participant = await prisma.participant.create({ data: { sportLeagueId: league.id, name: 'Avery Hart', participantType: 'INDIVIDUAL' } });
    const stranger = await prisma.participant.create({ data: { sportLeagueId: other.id, name: 'Avery Hart', participantType: 'INDIVIDUAL' } });
    const map = (participantId: string) => getApp().inject({ method: 'POST', url: `/api/v1/ingestion/sync-findings/${findingId}/participant-mapping`, headers: rootAdmin.headers, payload: { participantId } });

    const otherLeagueRes = await map(stranger.id);
    const missingRes = await map(randomUUID());
    const mappedRes = await map(participant.id);
    const againRes = await map(participant.id);

    expect(otherLeagueRes.statusCode).toBe(422);
    expect(ErrorEnvelopeSchema.parse(otherLeagueRes.json()).error.code).toBe('SYNC_FINDING_PARTICIPANT_OTHER_LEAGUE');
    expect(missingRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(missingRes.json()).error.code).toBe('PARTICIPANT_NOT_FOUND');
    expect(ProviderSyncFindingResponseSchema.parse(mappedRes.json()).finding).toMatchObject({ status: ProviderSyncFindingStatus.RESOLVED, actions: [ProviderSyncFindingAction.REOPEN] });
    const finding = await prisma.providerSyncFinding.findUniqueOrThrow({ where: { id: findingId } });
    expect(await prisma.participantProviderMapping.findMany({ where: { participantId: participant.id }, select: { providerId: true, externalId: true } }))
      .toEqual([{ providerId: provider.id, externalId: finding.providerValue }]);
    expect(againRes.statusCode).toBe(409);
  });

  it('counts a league\'s open findings by severity in its Sports page Issues, most serious first', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const league = await golfLeague();
    const provider = await balldontlie();
    const repository = new PrismaProviderSyncFindingRepository(getPrisma());
    const [, , resolved] = await repository.raise([
      unmapped(league.id, provider.id, 'w-1'),
      unmapped(league.id, provider.id, 'e-1', ProviderSyncFindingSeverity.ERROR),
      unmapped(league.id, provider.id, 'w-resolved'),
      unmapped(league.id, provider.id, 'w-2'),
    ], NOW);
    await getPrisma().providerSyncFinding.update({ where: { id: resolved.id }, data: { status: ProviderSyncFindingStatus.RESOLVED } });

    const res = await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues/overview', headers: rootAdmin.headers });

    expect(res.statusCode).toBe(200);
    const overview = SportLeagueOverviewListResponseSchema.parse(res.json()).sportLeagues.find((row) => row.id === league.id);
    expect(overview?.issues[0]).toEqual({
      type: 'FINDINGS',
      count: 3,
      items: [{ severity: ProviderSyncFindingSeverity.ERROR, count: 1 }, { severity: ProviderSyncFindingSeverity.WARNING, count: 2 }],
    });
  });

  it('answers requests up to the minute\'s limit, then 429 SYNC_FINDINGS_RATE_LIMITED for that address only', async () => {
    const rootAdmin = await createTestUser({ isRootAdmin: true });
    const read = (remoteAddress: string) => getApp().inject({ method: 'GET', url: '/api/v1/ingestion/sync-findings', headers: rootAdmin.headers, remoteAddress });
    for (let index = 0; index < SYNC_FINDINGS_REQUESTS_PER_MINUTE; index += 1) {
      // A request at a time, as the grid makes them.
      expect((await read('10.2.0.9')).statusCode).toBe(200);
    }

    const over = await read('10.2.0.9');
    expect(over.statusCode).toBe(429);
    expect(ErrorEnvelopeSchema.parse(over.json())).toMatchObject({ error: { code: 'SYNC_FINDINGS_RATE_LIMITED' } });
    expect((await read('10.2.0.10')).statusCode).toBe(200);
  });
});
