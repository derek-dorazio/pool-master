import { resolveMappedParticipantFindingsJobHandler } from '../../../packages/core-api/src/modules/ingestion/findings/mapped-participant-findings-job';
import { DISCARD_BACKGROUND_JOB } from '../../../packages/core-api/src/modules/background-jobs/background-job-outcome';
/**
 * Sync findings (#1999): what the service raises for the sync, what a root admin's status change
 * and participant mapping do, which actions a finding offers, and the retention cleanup. The
 * repository is an in-memory double of the port; its dedupe is proved against Postgres in
 * tests/integration/core-api/sync-findings.integration.ts.
 */
import { expect } from '@jest/globals';
import type { ProviderSyncFindingRepository, ProviderSyncFindingResolveFilter, SlotNamePatternChoices, SlotNamePatternRepository } from '@poolmaster/shared/db';
import {
  ParticipantStatus,
  ParticipantType,
  ProviderSyncFindingAction,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
  providerSourceIdOf,
  providerSyncFindingActions,
  RESOLVED_SYNC_FINDING_RETENTION_DAYS,
  SlotKind,
  Sport,
  type Participant,
  type ProviderSyncFinding,
  type ProviderSyncFindingRaise,
} from '@poolmaster/shared/domain';
import {
  ProviderSyncFindingService,
  type ProviderSyncFindingServiceDeps,
} from '../../../packages/core-api/src/modules/ingestion/findings/provider-sync-finding-service';
import { SyncFindingRetention } from '../../../packages/core-api/src/modules/ingestion/findings/sync-finding-retention';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';
import { fakeLogger } from '../../support/fake-logger';

const NOW = new Date('2027-04-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;
const PROVIDER = balldontlieTestProvider();
const LEAGUE = { id: 'league-1', name: 'PGA TOUR', sport: Sport.GOLF };

function finding(overrides: Partial<ProviderSyncFinding> = {}): ProviderSyncFinding {
  return {
    id: 'finding-1',
    kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT,
    severity: ProviderSyncFindingSeverity.WARNING,
    status: ProviderSyncFindingStatus.OPEN,
    sportLeague: LEAGUE,
    sportEvent: null,
    provider: { id: PROVIDER.id, name: PROVIDER.name },
    providerValue: 'golfer-9',
    providerValueName: 'Avery Hart',
    waiveNote: null,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    seenCount: 1,
    statusChangedAt: NOW,
    statusChangedBy: null,
    ...overrides,
  };
}

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'participant-1', createdAt: NOW, updatedAt: NOW, sportLeagueId: LEAGUE.id, ranking: null, name: 'Avery Hart',
    participantType: ParticipantType.INDIVIDUAL, status: ParticipantStatus.ACTIVE, injuryStatus: { status: 'HEALTHY' },
    ...overrides,
  };
}

/** The findings table in memory: raise opens every finding it is given, as a new subject would. */
function inMemoryFindings(rows: ProviderSyncFinding[] = []) {
  const raised: ProviderSyncFindingRaise[][] = [];
  const resolved: ProviderSyncFindingResolveFilter[] = [];
  const repository: ProviderSyncFindingRepository = {
    raise: async (raises) => {
      raised.push([...raises]);
      return raises.map((raise, index) => ({ id: `raised-${String(index)}`, kind: raise.kind, severity: raise.severity, sportLeagueId: raise.sportLeagueId }));
    },
    resolveOpen: async (filter) => { resolved.push(filter); return 0; },
    findAll: async () => rows,
    findById: async (id) => rows.find((row) => row.id === id) ?? null,
    setStatus: async (id, change) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined) return null;
      Object.assign(row, { status: change.status, waiveNote: change.waiveNote, statusChangedAt: change.changedAt, statusChangedBy: { id: change.changedByUserId, firstName: 'Root', lastName: 'Admin', username: 'root', email: 'root@example.test' } });
      return row;
    },
    deleteResolvedBatchBefore: async () => 0,
  };
  return { repository, rows, raised, resolved };
}

/** The PGA's NAME_PATTERN definitions through its mapping to BALLDONTLIE, and the patterns added (#2011). */
function inMemorySlotPatterns() {
  const choices: SlotNamePatternChoices = {
    sportLeagueProviderMappingId: 'pga-balldontlie',
    slots: [{ slotDefinitionId: 'masters', key: 'MASTERS', slotKind: SlotKind.TOURNAMENT, weekNumber: null, name: 'Masters Tournament', patterns: ['masters tournament'] }],
  };
  const added: Array<{ sportLeagueId: string; sportLeagueProviderMappingId: string; slotDefinitionId: string; pattern: string }> = [];
  const repository: SlotNamePatternRepository = {
    findChoices: async (sportLeagueId, providerId) => (sportLeagueId === LEAGUE.id && providerId === PROVIDER.id ? choices : null),
    addPattern: async (input) => {
      if (choices.slots.some((slot) => slot.patterns.includes(input.pattern))) return 'TAKEN';
      added.push(input);
      return 'ADDED';
    },
  };
  return { repository, added };
}

function service(overrides: Partial<ProviderSyncFindingServiceDeps> = {}) {
  const table = inMemoryFindings();
  const patterns = inMemorySlotPatterns();
  const bound: [string, string, string][] = [];
  const logger = fakeLogger();
  const deps: ProviderSyncFindingServiceDeps = {
    repository: table.repository,
    providers: { all: () => [PROVIDER] },
    participants: {
      findById: async (id) => (id === 'participant-1' ? participant() : id === 'elsewhere' ? participant({ id, sportLeagueId: 'league-2', name: 'Kai Moss' }) : null),
      bindProviderMapping: async (participantId, providerId, externalId) => {
        bound.push([participantId, providerId, externalId]);
        return { id: 'mapping-1', participantId, sportLeagueId: LEAGUE.id, providerId, externalId, createdAt: NOW, updatedAt: NOW } as never;
      },
    },
    slotNamePatterns: patterns.repository,
    now: () => NOW,
    logger,
    ...overrides,
  };
  return { findings: new ProviderSyncFindingService(deps), table, bound, logger, patterns };
}

describe('providerSyncFindingActions', () => {
  it('offers an OPEN unmapped participant its map action, then resolve and waive', () => {
    expect(providerSyncFindingActions({ kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT, status: ProviderSyncFindingStatus.OPEN }))
      .toEqual([ProviderSyncFindingAction.MAP_PARTICIPANT, ProviderSyncFindingAction.RESOLVE, ProviderSyncFindingAction.WAIVE]);
  });

  it('offers an OPEN missing webhook secret only resolve and waive, since its fix is outside the app', () => {
    expect(providerSyncFindingActions({ kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, status: ProviderSyncFindingStatus.OPEN }))
      .toEqual([ProviderSyncFindingAction.RESOLVE, ProviderSyncFindingAction.WAIVE]);
  });

  it('offers a resolved or waived finding only reopen', () => {
    for (const status of [ProviderSyncFindingStatus.RESOLVED, ProviderSyncFindingStatus.WAIVED]) {
      expect(providerSyncFindingActions({ kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT, status })).toEqual([ProviderSyncFindingAction.REOPEN]);
    }
  });
});

describe('ProviderSyncFindingService raising', () => {
  it('raises one WARNING per unmapped feed id on the league, from the feed\'s Provider row, with the feed\'s name', async () => {
    const { findings, table } = service();

    await findings.raiseUnmappedParticipants({
      sportLeagueId: LEAGUE.id,
      providerSourceId: providerSourceIdOf(PROVIDER.code),
      participants: [{ externalId: 'golfer-9', name: 'Avery Hart' }, { externalId: 'golfer-10', name: null }],
    });

    expect(table.raised).toEqual([[
      { kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT, severity: ProviderSyncFindingSeverity.WARNING, sportLeagueId: LEAGUE.id, sportEventId: null, providerId: PROVIDER.id, providerValue: 'golfer-9', providerValueName: 'Avery Hart' },
      { kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT, severity: ProviderSyncFindingSeverity.WARNING, sportLeagueId: LEAGUE.id, sportEventId: null, providerId: PROVIDER.id, providerValue: 'golfer-10', providerValueName: null },
    ]]);
  });

  it('raises nothing when every feed id is mapped', async () => {
    const { findings, table } = service();

    await findings.raiseUnmappedParticipants({ sportLeagueId: LEAGUE.id, providerSourceId: providerSourceIdOf(PROVIDER.code), participants: [] });

    expect(table.raised).toEqual([]);
  });

  it('raises nothing, and logs a warning, for a feed with no Provider row to map from', async () => {
    const { findings, table, logger } = service();

    await findings.raiseUnmappedParticipants({ sportLeagueId: LEAGUE.id, providerSourceId: 'mock-contest-feed', participants: [{ externalId: 'x', name: null }] });

    expect(table.raised).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.syncFinding.unmappedWithoutProvider' }), expect.any(String));
  });

  it('logs ingestion.syncFinding.errorOpened for each ERROR the raise opens, which the alarm counts, and not for a WARNING', async () => {
    const { findings, logger } = service();

    await findings.raise([
      { kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, severity: ProviderSyncFindingSeverity.ERROR, sportLeagueId: LEAGUE.id, sportEventId: null, providerId: PROVIDER.id, providerValue: null, providerValueName: null },
      { kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT, severity: ProviderSyncFindingSeverity.WARNING, sportLeagueId: LEAGUE.id, sportEventId: null, providerId: PROVIDER.id, providerValue: 'g', providerValueName: null },
    ]);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { action: 'ingestion.syncFinding.errorOpened', findingId: 'raised-0', kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, sportLeagueId: LEAGUE.id },
      expect.any(String),
    );
  });

  it('raises a missing webhook secret ERROR on each league the Provider syncs, and resolves it on every league it no longer syncs', async () => {
    const { findings, table } = service();

    await findings.checkWebhookSecrets({
      syncedLeagues: [
        buildSportLeague({ id: 'nfl', selectedProviderMapping: buildProviderMapping({ providerCode: PROVIDER.code }) }),
        buildSportLeague({ id: 'unsynced', selectedProviderMapping: null }),
      ],
      isMissingSecret: () => true,
    });

    // A league the Provider no longer syncs has its finding resolved (#2070).
    expect(table.resolved).toEqual([{ kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, providerId: PROVIDER.id, exceptSportLeagueIds: ['nfl'] }]);
    expect(table.raised).toEqual([[
      { kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, severity: ProviderSyncFindingSeverity.ERROR, sportLeagueId: 'nfl', sportEventId: null, providerId: PROVIDER.id, providerValue: null, providerValueName: null },
    ]]);
  });

  it('resolves a Provider\'s missing webhook secret findings once its secret is set or its webhooks are off', async () => {
    const { findings, table } = service();

    await findings.checkWebhookSecrets({ syncedLeagues: [buildSportLeague({ id: 'nfl' })], isMissingSecret: () => false });

    expect(table.raised).toEqual([]);
    expect(table.resolved).toEqual([{ kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, providerId: PROVIDER.id }]);
  });
});

describe('ProviderSyncFindingService rate-limit findings', () => {
  it('raises one PROVIDER_RATE_LIMITED finding per league at the severity the streak reached there', async () => {
    const { findings, table } = service();

    await findings.raiseProviderRateLimited({
      providerId: PROVIDER.id,
      leagues: [{ sportLeagueId: 'nfl', severity: ProviderSyncFindingSeverity.ERROR }, { sportLeagueId: 'pga', severity: ProviderSyncFindingSeverity.WARNING }],
    });

    expect(table.raised).toEqual([[
      { kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED, severity: ProviderSyncFindingSeverity.ERROR, sportLeagueId: 'nfl', sportEventId: null, providerId: PROVIDER.id, providerValue: null, providerValueName: null },
      { kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED, severity: ProviderSyncFindingSeverity.WARNING, sportLeagueId: 'pga', sportEventId: null, providerId: PROVIDER.id, providerValue: null, providerValueName: null },
    ]]);
  });

  it('logs ingestion.syncFinding.errorOpened for an ERROR that escalates an open WARNING, not only one newly opened, so the alarm hears it', async () => {
    const { findings, table, logger } = service();
    table.repository.raise = async () => [];

    await findings.raiseProviderRateLimited({ providerId: PROVIDER.id, leagues: [{ sportLeagueId: 'nfl', severity: ProviderSyncFindingSeverity.ERROR }] });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ingestion.syncFinding.errorOpened', kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED, sportLeagueId: 'nfl', escalated: true }),
      expect.any(String),
    );
  });

  it('logs no error for a WARNING, and raises nothing for no leagues', async () => {
    const { findings, table, logger } = service();

    await findings.raiseProviderRateLimited({ providerId: PROVIDER.id, leagues: [{ sportLeagueId: 'nfl', severity: ProviderSyncFindingSeverity.WARNING }] });
    await findings.raiseProviderRateLimited({ providerId: PROVIDER.id, leagues: [] });

    expect(table.raised).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('resolves only the Provider\'s rate-limit findings when it answers again', async () => {
    const { findings, table } = service();

    await findings.resolveProviderRateLimited(PROVIDER.id);

    expect(table.resolved).toEqual([{ kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED, providerId: PROVIDER.id }]);
  });});

describe('ProviderSyncFindingService league resolves by source', () => {
  it('resolves only the named league\'s open findings of the kind against the Provider the source id names', async () => {
    const { findings, table } = service();

    await findings.resolveOfSource(providerSourceIdOf(PROVIDER.code), { kind: ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN, sportLeagueId: 'nfl' });

    expect(table.resolved).toEqual([{ kind: ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN, sportLeagueId: 'nfl', providerId: PROVIDER.id }]);
  });

  it('resolves nothing for a source id no Provider row has', async () => {
    const { findings, table } = service();

    await expect(findings.resolveOfSource('mock-contest-feed', { kind: ProviderSyncFindingKind.PROVIDER_LEAGUE_UNKNOWN, sportLeagueId: 'nfl' })).resolves.toBe(0);

    expect(table.resolved).toEqual([]);
  });
});

describe('The resolve mapped participant findings job', () => {
  const payload = { sportLeagueId: 'nfl', providerId: PROVIDER.id, externalIds: ['p-1'] };

  it('keeps how many findings it resolved on the job', async () => {
    await expect(resolveMappedParticipantFindingsJobHandler({ resolveMappedParticipants: async () => 2 })(payload)).resolves.toEqual({ changedCount: 2 });
  });

  it('leaves no Activity row when the mapped ids had no open finding', async () => {
    await expect(resolveMappedParticipantFindingsJobHandler({ resolveMappedParticipants: async () => 0 })(payload)).resolves.toBe(DISCARD_BACKGROUND_JOB);
  });
});

describe('ProviderSyncFindingService mapped participants', () => {
  it('resolves the league\'s unmapped participant findings of exactly the feed ids a mapping named', async () => {
    const { findings, table } = service();

    await findings.resolveMappedParticipants({ sportLeagueId: 'nfl', providerId: PROVIDER.id, externalIds: ['p-1', 'p-2'] });

    expect(table.resolved).toEqual([{ kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT, sportLeagueId: 'nfl', providerId: PROVIDER.id, providerValues: ['p-1', 'p-2'] }]);
  });
});

describe('ProviderSyncFindingService event checks (#1999)', () => {
  const check = { kind: ProviderSyncFindingKind.NO_PROVIDER_PARTICIPANTS, sportLeagueId: 'nfl', sportEventId: 'week-1', providerId: PROVIDER.id };

  it('raises a WARNING on the event when the sync found the problem', async () => {
    const { findings, table } = service();

    await findings.checkEvent({ ...check, found: true });

    expect(table.raised).toEqual([[{ ...check, severity: ProviderSyncFindingSeverity.WARNING, providerValue: null, providerValueName: null }]]);
    expect(table.resolved).toEqual([]);
  });

  it('resolves the event\'s open finding of the kind, and only that event\'s, when the sync did not find it', async () => {
    const { findings, table } = service();

    await findings.checkEvent({ ...check, found: false });

    expect(table.raised).toEqual([]);
    expect(table.resolved).toEqual([check]);
  });

  it('checks an event for a feed known by its source id under the feed\'s Provider row, and checks nothing for a feed with none', async () => {
    const { findings, table } = service();
    const bySource = { kind: check.kind, sportLeagueId: check.sportLeagueId, sportEventId: check.sportEventId };

    await findings.checkEventOfSource({ ...bySource, providerSourceId: providerSourceIdOf(PROVIDER.code), found: false });
    await findings.checkEventOfSource({ ...bySource, providerSourceId: 'mock-contest-feed', found: true });

    expect(table.resolved).toEqual([check]);
    expect(table.raised).toEqual([]);
  });
});

describe('ProviderSyncFindingService reads', () => {
  it('lists every finding and answers one by id', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings } = service({ repository: table.repository });

    await expect(findings.list()).resolves.toEqual([finding()]);
    await expect(findings.get('finding-1')).resolves.toEqual(finding());
  });

  it('answers 404 SYNC_FINDING_NOT_FOUND for an unknown finding', async () => {
    await expect(service().findings.get('missing')).rejects.toMatchObject({ code: 'SYNC_FINDING_NOT_FOUND', statusCode: 404 });
  });
});

describe('ProviderSyncFindingService.changeStatus', () => {
  it('waives an OPEN finding with its trimmed note, as the admin who did it', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings } = service({ repository: table.repository });

    const saved = await findings.changeStatus('finding-1', { action: ProviderSyncFindingAction.WAIVE, waiveNote: '  An amateur  ', userId: 'admin-1' });

    expect(saved).toMatchObject({ status: ProviderSyncFindingStatus.WAIVED, waiveNote: 'An amateur', statusChangedAt: NOW, statusChangedBy: { id: 'admin-1' } });
  });

  it('refuses a waive with no note as 422 SYNC_FINDING_WAIVE_NOTE_REQUIRED, and leaves the finding OPEN', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings } = service({ repository: table.repository });

    await expect(findings.changeStatus('finding-1', { action: ProviderSyncFindingAction.WAIVE, waiveNote: '   ', userId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'SYNC_FINDING_WAIVE_NOTE_REQUIRED', statusCode: 422 });
    expect(table.rows[0]?.status).toBe(ProviderSyncFindingStatus.OPEN);
  });

  it('resolves an OPEN finding and clears any note; reopening a waived one clears its note too', async () => {
    const table = inMemoryFindings([finding(), finding({ id: 'waived', status: ProviderSyncFindingStatus.WAIVED, waiveNote: 'Accepted' })]);
    const { findings } = service({ repository: table.repository });

    await expect(findings.changeStatus('finding-1', { action: ProviderSyncFindingAction.RESOLVE, waiveNote: 'ignored', userId: 'admin-1' }))
      .resolves.toMatchObject({ status: ProviderSyncFindingStatus.RESOLVED, waiveNote: null });
    await expect(findings.changeStatus('waived', { action: ProviderSyncFindingAction.REOPEN, waiveNote: null, userId: 'admin-1' }))
      .resolves.toMatchObject({ status: ProviderSyncFindingStatus.OPEN, waiveNote: null });
  });

  it('refuses an action the finding does not offer now as 409 SYNC_FINDING_ACTION_NOT_OFFERED', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings } = service({ repository: table.repository });

    await expect(findings.changeStatus('finding-1', { action: ProviderSyncFindingAction.REOPEN, waiveNote: null, userId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'SYNC_FINDING_ACTION_NOT_OFFERED', statusCode: 409 });
  });

  it('answers 404 when the finding is gone by the time its status is saved', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings } = service({ repository: { ...table.repository, setStatus: async () => null } });

    await expect(findings.changeStatus('finding-1', { action: ProviderSyncFindingAction.RESOLVE, waiveNote: null, userId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'SYNC_FINDING_NOT_FOUND', statusCode: 404 });
  });
});

describe('ProviderSyncFindingService "link to existing" (#2011)', () => {
  const unmatched = (overrides: Partial<ProviderSyncFinding> = {}) => finding({
    kind: ProviderSyncFindingKind.SLOT_NAME_UNMATCHED, severity: ProviderSyncFindingSeverity.INFO, providerValue: 'the masters', providerValueName: 'The 2027 Masters', ...overrides,
  });

  it('offers LINK_SLOT, then resolve and waive, only on an open tournament name finding', () => {
    expect(providerSyncFindingActions(unmatched())).toEqual([ProviderSyncFindingAction.LINK_SLOT, ProviderSyncFindingAction.RESOLVE, ProviderSyncFindingAction.WAIVE]);
    expect(providerSyncFindingActions(unmatched({ kind: ProviderSyncFindingKind.SLOT_NAME_AMBIGUOUS }))).toEqual([ProviderSyncFindingAction.RESOLVE, ProviderSyncFindingAction.WAIVE]);
  });

  it('lists the league\'s name-matched slot definitions through its mapping to the finding\'s Provider', async () => {
    const table = inMemoryFindings([unmatched()]);
    const { findings } = service({ repository: table.repository });

    expect(await findings.slotLinkChoices('finding-1')).toEqual([expect.objectContaining({ slotDefinitionId: 'masters', patterns: ['masters tournament'] })]);
  });

  it('adds the finding\'s normalized name as a pattern of the chosen definition and resolves the finding', async () => {
    const table = inMemoryFindings([unmatched()]);
    const { findings, patterns } = service({ repository: table.repository });

    const saved = await findings.linkSlot('finding-1', { slotDefinitionId: 'masters', userId: 'admin-1' });

    expect(patterns.added).toEqual([{ sportLeagueId: LEAGUE.id, sportLeagueProviderMappingId: 'pga-balldontlie', slotDefinitionId: 'masters', pattern: 'the masters' }]);
    expect(saved).toMatchObject({ status: ProviderSyncFindingStatus.RESOLVED, statusChangedBy: { id: 'admin-1' } });
  });

  it('refuses a definition it does not offer as 404 SLOT_DEFINITION_NOT_FOUND and adds nothing', async () => {
    const table = inMemoryFindings([unmatched()]);
    const { findings, patterns } = service({ repository: table.repository });

    await expect(findings.linkSlot('finding-1', { slotDefinitionId: 'week-1', userId: 'admin-1' })).rejects.toMatchObject({ code: 'SLOT_DEFINITION_NOT_FOUND', statusCode: 404 });
    expect(patterns.added).toEqual([]);
  });

  it('refuses a name that already places a tournament as 409 SLOT_NAME_PATTERN_TAKEN and leaves the finding open', async () => {
    const table = inMemoryFindings([unmatched({ providerValue: 'masters tournament' })]);
    const { findings } = service({ repository: table.repository });

    await expect(findings.linkSlot('finding-1', { slotDefinitionId: 'masters', userId: 'admin-1' })).rejects.toMatchObject({ code: 'SLOT_NAME_PATTERN_TAKEN', statusCode: 409 });
    expect(table.rows[0].status).toBe(ProviderSyncFindingStatus.OPEN);
  });

  it('offers no slots, and links none, for a finding whose league has no mapping to its Provider or that names no Provider', async () => {
    const table = inMemoryFindings([unmatched({ id: 'other', sportLeague: { ...LEAGUE, id: 'league-2' } }), unmatched({ id: 'no-provider', provider: null })]);
    const { findings } = service({ repository: table.repository });

    expect(await findings.slotLinkChoices('other')).toEqual([]);
    expect(await findings.slotLinkChoices('no-provider')).toEqual([]);
    await expect(findings.linkSlot('other', { slotDefinitionId: 'masters', userId: 'admin-1' })).rejects.toMatchObject({ code: 'SLOT_DEFINITION_NOT_FOUND' });
  });

  it('refuses both on a finding that does not offer LINK_SLOT now as 409 SYNC_FINDING_ACTION_NOT_OFFERED', async () => {
    const table = inMemoryFindings([unmatched({ status: ProviderSyncFindingStatus.RESOLVED })]);
    const { findings } = service({ repository: table.repository });

    await expect(findings.slotLinkChoices('finding-1')).rejects.toMatchObject({ code: 'SYNC_FINDING_ACTION_NOT_OFFERED', statusCode: 409 });
    await expect(findings.linkSlot('finding-1', { slotDefinitionId: 'masters', userId: 'admin-1' })).rejects.toMatchObject({ code: 'SYNC_FINDING_ACTION_NOT_OFFERED', statusCode: 409 });
  });
});

describe('ProviderSyncFindingService.mapParticipant', () => {
  it('binds the feed\'s id to the league\'s participant under the finding\'s Provider row, and resolves the finding', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings, bound } = service({ repository: table.repository });

    const saved = await findings.mapParticipant('finding-1', { participantId: 'participant-1', userId: 'admin-1' });

    expect(bound).toEqual([['participant-1', PROVIDER.id, 'golfer-9']]);
    expect(saved).toMatchObject({ status: ProviderSyncFindingStatus.RESOLVED, statusChangedBy: { id: 'admin-1' } });
  });

  it('refuses a participant of another league as 422 SYNC_FINDING_PARTICIPANT_OTHER_LEAGUE and binds nothing', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings, bound } = service({ repository: table.repository });

    await expect(findings.mapParticipant('finding-1', { participantId: 'elsewhere', userId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'SYNC_FINDING_PARTICIPANT_OTHER_LEAGUE', statusCode: 422 });
    expect(bound).toEqual([]);
  });

  it('refuses an unknown participant as 404 PARTICIPANT_NOT_FOUND', async () => {
    const table = inMemoryFindings([finding()]);

    await expect(service({ repository: table.repository }).findings.mapParticipant('finding-1', { participantId: 'nobody', userId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND', statusCode: 404 });
  });

  it('refuses mapping a finding whose kind has no map action, or one already resolved, as 409', async () => {
    const table = inMemoryFindings([
      finding({ id: 'webhook', kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, providerValue: null }),
      finding({ id: 'resolved', status: ProviderSyncFindingStatus.RESOLVED }),
    ]);
    const { findings } = service({ repository: table.repository });

    for (const id of ['webhook', 'resolved']) {
      await expect(findings.mapParticipant(id, { participantId: 'participant-1', userId: 'admin-1' }))
        .rejects.toMatchObject({ code: 'SYNC_FINDING_ACTION_NOT_OFFERED', statusCode: 409 });
    }
  });

  it('fails loudly for an unmapped participant finding that names no Provider row, rather than binding under a guessed id', async () => {
    const table = inMemoryFindings([finding({ provider: null })]);
    const { findings, bound } = service({ repository: table.repository });

    await expect(findings.mapParticipant('finding-1', { participantId: 'participant-1', userId: 'admin-1' })).rejects.toThrow('names no Provider row');
    expect(bound).toEqual([]);
  });

  it('answers 404 when the finding is gone by the time it is resolved', async () => {
    const table = inMemoryFindings([finding()]);
    const { findings } = service({ repository: { ...table.repository, setStatus: async () => null } });

    await expect(findings.mapParticipant('finding-1', { participantId: 'participant-1', userId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'SYNC_FINDING_NOT_FOUND', statusCode: 404 });
  });
});

describe('sync finding retention', () => {
  it('deletes findings resolved more than the retention days ago, in batches, until a batch comes back short', async () => {
    const befores: Date[] = [];
    const batches = [500, 3];
    const retention = new SyncFindingRetention({
      deleteResolvedBatchBefore: async (before) => { befores.push(before); return batches.shift() ?? 0; },
    });

    const deleted = await retention.purge(NOW);

    expect(deleted).toBeGreaterThanOrEqual(3);
    expect(befores[0]).toEqual(new Date(NOW.getTime() - RESOLVED_SYNC_FINDING_RETENTION_DAYS * DAY_MS));
    expect(retention.name).toBe('syncFindings');
  });
});
