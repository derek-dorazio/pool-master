import { expect } from '@jest/globals';
import { MappingConfidence } from '@poolmaster/shared/domain';
import type { AmbiguousFeedParticipant } from '@poolmaster/shared/domain';
import type { AmbiguousFeedParticipantRepository } from '@poolmaster/shared/db';
import {
  FeedParticipantLinkError,
  FeedParticipantLinkService,
} from '../../../packages/core-api/src/modules/ingestion/feed-participant-links';
import { fakeParticipantProviderMappingRepo } from '../../support/repo-fakes';

/** A feed participant needing linking: Tom Kim from the balldontlie feed, two site Tom Kims its candidates. */
function needsLinking(overrides: Partial<AmbiguousFeedParticipant> = {}): AmbiguousFeedParticipant {
  return {
    id: 'held-1',
    sportLeagueId: 'league-pga',
    providerId: 'balldontlie',
    externalId: 'bdl-1',
    feedName: 'Tom Kim',
    candidates: [{ participantId: 'site-a', name: 'Tom Kim' }, { participantId: 'site-b', name: 'Tom Kim' }],
    events: [{ sportEventId: 'event-1', name: 'The Open', startDate: new Date('2027-07-15T00:00:00.000Z') }],
    resolvedAt: null,
    resolvedParticipantId: null,
    createdAt: new Date('2026-11-18T00:00:00.000Z'),
    updatedAt: new Date('2026-11-18T00:00:00.000Z'),
    ...overrides,
  };
}

/** An in-memory store of rows; resolving through the persistence double marks the row resolved, as the real write does. */
function world(rows: AmbiguousFeedParticipant[], options: { mapped?: boolean; pickMapped?: boolean; outcome?: 'RESOLVED_ALREADY' | 'FEED_ID_MAPPED' } = {}) {
  const store = new Map(rows.map((row) => [row.id, row]));
  const ambiguous: AmbiguousFeedParticipantRepository = {
    listOpen: ({ sportLeagueId }) => Promise.resolve([...store.values()].filter((row) => row.resolvedAt === null && (sportLeagueId === undefined || row.sportLeagueId === sportLeagueId))),
    findById: (id) => Promise.resolve(store.get(id) ?? null),
    countOpenForEvent: () => Promise.resolve(0),
    resolveFeedId: () => Promise.resolve(),
  };
  const resolved: Array<{ id: string; participantId: string | null }> = [];
  const persistence = {
    resolveAmbiguousFeedParticipant: (id: string, participantId: string | null) => {
      resolved.push({ id, participantId });
      if (options.outcome) return Promise.resolve({ outcome: options.outcome });
      const linked = participantId ?? 'created-1';
      const row = store.get(id) as AmbiguousFeedParticipant;
      store.set(id, { ...row, resolvedAt: new Date('2026-11-18T05:00:00.000Z'), resolvedParticipantId: linked });
      return Promise.resolve({ outcome: 'RESOLVED' as const, participantId: linked, fieldRowsWritten: row.events.length });
    },
  };
  const mapping = (participantId: string, externalId: string) => ({
    id: `mapping-${externalId}`, participantId, providerId: 'balldontlie', externalId, confidence: MappingConfidence.MANUAL, mappedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  });
  const mappings = fakeParticipantProviderMappingRepo({
    findByParticipant: (participantId) => Promise.resolve(options.pickMapped ? [mapping(participantId, 'bdl-other')] : []),
    findByProviderExternalIds: () => Promise.resolve(options.mapped ? [mapping('site-z', 'bdl-1')] : []),
  });
  const service = new FeedParticipantLinkService({ ambiguous, mappings, persistence });
  return { service, resolved };
}

describe('FeedParticipantLinkService (#1824)', () => {
  it('lists the open rows of the sport league asked for, and every league\'s without one', async () => {
    const { service } = world([
      needsLinking(),
      needsLinking({ id: 'held-2', sportLeagueId: 'league-lpga' }),
      needsLinking({ id: 'held-3', resolvedAt: new Date() }),
    ]);

    await expect(service.listOpen({ sportLeagueId: 'league-pga' }).then((rows) => rows.map((row) => row.id))).resolves.toEqual(['held-1']);
    await expect(service.listOpen({}).then((rows) => rows.map((row) => row.id))).resolves.toEqual(['held-1', 'held-2']);
  });

  it('links the row to the candidate picked and answers it resolved as linked to that candidate', async () => {
    const { service, resolved } = world([needsLinking()]);

    const row = await service.resolve('held-1', { resolution: 'LINK', participantId: 'site-b' });

    expect(resolved).toEqual([{ id: 'held-1', participantId: 'site-b' }]);
    expect(row).toMatchObject({ id: 'held-1', resolvedParticipantId: 'site-b', resolvedAt: expect.any(Date) });
  });

  it('creates a new participant for the row when none of its candidates is it', async () => {
    const { service, resolved } = world([needsLinking()]);

    const row = await service.resolve('held-1', { resolution: 'CREATE' });

    expect(resolved).toEqual([{ id: 'held-1', participantId: null }]);
    expect(row.resolvedParticipantId).toBe('created-1');
  });

  it.each([
    ['there is no such row', [], { resolution: 'CREATE' as const }, 'FEED_PARTICIPANT_LINK_NOT_FOUND', 404, false],
    ['the row was resolved already', [needsLinking({ resolvedAt: new Date() })], { resolution: 'CREATE' as const }, 'FEED_PARTICIPANT_LINK_RESOLVED', 409, false],
    ['the pick is not one of its candidates', [needsLinking()], { resolution: 'LINK' as const, participantId: 'site-z' }, 'FEED_PARTICIPANT_NOT_A_CANDIDATE', 422, false],
    ['its feed id was mapped some other way since', [needsLinking()], { resolution: 'LINK' as const, participantId: 'site-a' }, 'FEED_PARTICIPANT_ALREADY_MAPPED', 409, true],
    ['the provider maps the pick since the row was held', [needsLinking()], { resolution: 'LINK' as const, participantId: 'site-a' }, 'FEED_PARTICIPANT_NOT_A_CANDIDATE', 422, false, true],
  ])('refuses to resolve, and writes nothing, when %s', async (_label, rows, choice, code, statusCode, mapped, pickMapped = false) => {
    const { service, resolved } = world(rows, { mapped, pickMapped });

    await expect(service.resolve('held-1', choice)).rejects.toMatchObject({ code, statusCode });
    await expect(service.resolve('held-1', choice)).rejects.toBeInstanceOf(FeedParticipantLinkError);
    expect(resolved).toEqual([]);
  });

  it.each([
    ['resolved it first', 'RESOLVED_ALREADY' as const, 'FEED_PARTICIPANT_LINK_RESOLVED'],
    ['mapped its feed id first', 'FEED_ID_MAPPED' as const, 'FEED_PARTICIPANT_ALREADY_MAPPED'],
  ])('answers 409 when a concurrent write %s', async (_label, outcome, code) => {
    const { service } = world([needsLinking()], { outcome });

    await expect(service.resolve('held-1', { resolution: 'CREATE' })).rejects.toMatchObject({ code, statusCode: 409 });
  });
});
