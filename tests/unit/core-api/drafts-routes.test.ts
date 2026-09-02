import * as SharedDomainEnums from '@poolmaster/shared/domain/enums';
import { loadDraftContext } from '../../../packages/core-api/src/modules/drafts/routes';

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    contest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'contest-1',
        name: 'Masters Pool',
        leagueId: 'league-1',
        sportEventId: 'event-1',
        sportEvent: { startDate: new Date('2026-04-09T14:00:00.000Z') },
        selectionType: 'TIERED',
        status: 'OPEN',
        lockAt: null,
      }),
    },
    contestConfiguration: { findUnique: jest.fn().mockResolvedValue(null) },
    contestEntry: { findMany: jest.fn().mockResolvedValue([]) },
    leagueMembership: { findMany: jest.fn().mockResolvedValue([]) },
    squadMembership: { findMany: jest.fn().mockResolvedValue([]) },
    sportEventParticipant: { findMany: jest.fn().mockResolvedValue([]) },
    sportEventGolfTier: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('loadDraftContext', () => {
  it('pool-master-uvc: returns null when the contest does not exist', async () => {
    const prisma = createMockPrisma({
      contest: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    const context = await loadDraftContext(prisma as never, 'missing-contest');

    expect(context).toBeNull();
  });

  // pool-master-uvc — proves this call site delegates to the shared
  // deriveLegacyParticipantStatus derivation rather than a second copy of the
  // same ternary; the derivation's own branches are covered directly in
  // tests/unit/shared/domain-models.test.ts.
  it('derives selectionParticipants[].status via the shared deriveLegacyParticipantStatus function', async () => {
    const deriveSpy = jest.spyOn(SharedDomainEnums, 'deriveLegacyParticipantStatus');

    const prisma = createMockPrisma({
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sep-1',
            participantId: 'participant-1',
            isActive: false,
            inactiveReason: 'ELIMINATED',
            worldRanking: null,
            participant: { name: 'Eliminated Golfer', position: null, teamAffiliation: null },
            valuations: [],
          },
        ]),
      },
    });

    const context = await loadDraftContext(prisma as never, 'contest-1');

    expect(deriveSpy).toHaveBeenCalledWith(false, 'ELIMINATED');
    deriveSpy.mockRestore();
    expect(context?.selectionParticipants).toEqual([
      expect.objectContaining({
        participantName: 'Eliminated Golfer',
        status: 'ELIMINATED',
        isAvailable: false,
        unavailableReason: 'SportEventParticipant sep-1 is unavailable with status ELIMINATED',
      }),
    ]);
  });

  // pool-master-piv — proves loadDraftContext resolves tier/price through
  // golf-tier-service.getEffectiveTiersForSportEvent (plans/124 §4.6b)
  // rather than the dropped legacy SportEventParticipant.valuations table.
  it('pool-master-piv resolves selectionParticipants[].tier/price/orderIndex and context.tiers from golf-tier-service', async () => {
    const prisma = createMockPrisma({
      sportEventGolfTier: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tier-1',
            sportEventId: 'event-1',
            tierKey: 'tier-1',
            label: 'Tier 1',
            tierNumber: 1,
            defaultPickCount: 2,
            valuations: [
              {
                sportEventParticipantId: 'sep-1',
                tierOrderIndex: 1,
                price: 25,
                sportEventParticipant: { participantId: 'participant-1' },
              },
            ],
          },
        ]),
      },
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sep-1',
            participantId: 'participant-1',
            isActive: true,
            inactiveReason: null,
            worldRanking: 5,
            participant: { name: 'Rory McIlroy', position: null, teamAffiliation: null },
          },
        ]),
      },
    });

    const context = await loadDraftContext(prisma as never, 'contest-1');

    expect(context?.tiers).toEqual([
      { tierId: 'tier-1', tierName: 'Tier 1', tierNumber: 1, picksFromTier: 2, participantIds: ['participant-1'] },
    ]);
    expect(context?.selectionParticipants).toEqual([
      expect.objectContaining({
        sportEventParticipantId: 'sep-1',
        tier: 'Tier 1',
        price: 25,
        orderIndex: 1,
      }),
    ]);
  });
});
