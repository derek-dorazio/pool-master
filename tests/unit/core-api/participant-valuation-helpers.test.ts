import { calculatePrices } from '../../../packages/core-api/src/modules/participants/pricing-engine';
import { assignTiers } from '../../../packages/core-api/src/modules/participants/tier-engine';
import { calculateFormRating } from '../../../packages/core-api/src/modules/participants/form-rating-engine';
import { findMatches, nameSimilarity, normaliseName } from '../../../packages/core-api/src/modules/participants/deduplication';

describe('participant valuation helpers', () => {
  it('calculates prices across the configured range and applies overrides', () => {
    const result = calculatePrices(
      [
        { participantId: 'p1', ranking: 1, formRating: 90, oddsImpliedProb: 0.4 },
        { participantId: 'p2', ranking: 2, formRating: 70, oddsImpliedProb: 0.2 },
      ],
      {
        minPrice: 5000,
        maxPrice: 10000,
        priceIncrement: 500,
        rankingWeight: 1,
        formWeight: 1,
        oddsWeight: 1,
        seedWeight: 0,
        manualOverrides: [
          {
            participantId: 'p2',
            overridePrice: 6500,
            reason: 'manual correction',
            setBy: 'admin-1',
            setAt: new Date('2026-04-22T00:00:00.000Z'),
          },
        ],
        sport: 'GOLF',
        totalBudget: 50000,
      },
    );

    expect(result).toEqual([
      expect.objectContaining({ participantId: 'p1', isOverride: false, price: 10000 }),
      expect.objectContaining({ participantId: 'p2', isOverride: true, price: 6500 }),
    ]);
  });

  it('returns an empty price set for empty participant input', () => {
    expect(
      calculatePrices([], {
        minPrice: 5000,
        maxPrice: 10000,
        priceIncrement: 500,
        rankingWeight: 1,
        formWeight: 1,
        oddsWeight: 1,
        seedWeight: 0,
        manualOverrides: [],
        sport: 'GOLF',
        totalBudget: 50000,
      }),
    ).toEqual([]);
  });

  it('assigns tiers by ranking and manual participant lists', () => {
    expect(
      assignTiers(
        [
          { participantId: 'p1', ranking: 1 },
          { participantId: 'p2', ranking: 2 },
          { participantId: 'p3', ranking: 3 },
        ],
        {
          contestId: 'contest-1',
          sport: 'GOLF',
          assignmentMode: 'AUTO_RANKING',
          tiers: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
              rankingRange: [1, 2],
            },
            {
              tierId: 'tier-2',
              tierName: 'Tier 2',
              tierNumber: 2,
              picksFromTier: 1,
              participantIds: [],
              rankingRange: [3, 10],
            },
          ],
        },
      ),
    ).toEqual([
      { participantId: 'p1', tierId: 'tier-1', tierNumber: 1 },
      { participantId: 'p2', tierId: 'tier-1', tierNumber: 1 },
      { participantId: 'p3', tierId: 'tier-2', tierNumber: 2 },
    ]);

    expect(
      assignTiers([], {
        contestId: 'contest-1',
        sport: 'GOLF',
        assignmentMode: 'MANUAL',
        tiers: [
          {
            tierId: 'tier-1',
            tierName: 'Tier 1',
            tierNumber: 1,
            picksFromTier: 1,
            participantIds: ['p1', 'p2'],
          },
        ],
      }),
    ).toEqual([
      { participantId: 'p1', tierId: 'tier-1', tierNumber: 1 },
      { participantId: 'p2', tierId: 'tier-1', tierNumber: 1 },
    ]);
  });

  it('calculates form rating defaults and trend-aware ratings', () => {
    expect(calculateFormRating([])).toEqual({
      formRating: 50,
      formTrend: 'STABLE',
      eventsConsidered: 0,
    });

    expect(
      calculateFormRating([
        { eventId: 'e1', finishPosition: 1, fieldSize: 100, eventDate: new Date('2026-04-20') },
        { eventId: 'e2', finishPosition: 5, fieldSize: 100, eventDate: new Date('2026-04-13') },
        { eventId: 'e3', finishPosition: 20, fieldSize: 100, eventDate: new Date('2026-04-06') },
        { eventId: 'e4', finishPosition: 25, fieldSize: 100, eventDate: new Date('2026-03-30') },
      ]),
    ).toEqual(
      expect.objectContaining({
        formRating: expect.any(Number),
        formTrend: 'RISING',
        eventsConsidered: 4,
      }),
    );
  });

  it('normalises and matches participant names across exact, manual-review, and no-match branches', () => {
    expect(normaliseName('Garcia, Sergio')).toBe('sergio garcia');
    expect(nameSimilarity('Rory McIlroy', 'Rory McIlroy')).toBe(1);

    const exact = findMatches(
      'Garcia, Sergio',
      'GOLF',
      'ESP',
      [
        { id: 'p1', name: 'Sergio Garcia', sportId: 'GOLF', nationality: 'ESP' } as any,
      ],
    );
    expect(exact).toEqual(
      expect.objectContaining({
        canonicalParticipantId: 'p1',
        needsManualReview: false,
      }),
    );

    const manualReview = findMatches(
      'Jon Smyth',
      'GOLF',
      'USA',
      [
        { id: 'p2', name: 'John Smith', sportId: 'GOLF', nationality: 'CAN' } as any,
      ],
    );
    expect(manualReview).toEqual(
      expect.objectContaining({
        needsManualReview: true,
        candidates: [
          expect.objectContaining({
            confidence: 'LOW',
            matchMethod: 'NAME_FUZZY_LOW',
            score: expect.any(Number),
          }),
        ],
      }),
    );

    expect(
      findMatches('Brand New', 'GOLF', 'USA', [
        { id: 'p3', name: 'Existing Player', sportId: 'GOLF', nationality: 'USA' } as any,
      ]),
    ).toEqual({
      candidates: [],
      needsManualReview: false,
    });
  });
});
