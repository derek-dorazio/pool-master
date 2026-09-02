import {
  ContestConfigTemplateDtoSchema,
  ContestConfigurationRequestSchema,
  ContestManagementResponseSchema,
  CreateContestManagementRequestSchema,
  ListContestConfigTemplatesQuerySchema,
} from '../../../packages/shared/dto';

describe('contest-management dto schemas', () => {
  it('accepts a golf tiered contest configuration', () => {
    const parsed = CreateContestManagementRequestSchema.parse({
      name: 'Masters Pick 6',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      contestFormat: 'ROSTER',
      configuration: {
        mode: 'GOLF_TIERED',
        locksAt: '2026-04-10T12:00:00.000Z',
        maxEntriesPerSquad: 3,
        rosterSize: 6,
        countedScores: 4,
      },
    });

    if (!('configuration' in parsed)) {
      throw new Error('Expected legacy configuration payload');
    }
    expect(parsed.configuration.mode).toBe('GOLF_TIERED');
    if (parsed.configuration.mode !== 'GOLF_TIERED') {
      throw new Error('Expected golf tiered configuration');
    }
    expect(parsed.configuration.rosterSize).toBe(6);
    expect(parsed.configuration.countedScores).toBe(4);
  });

  it('rejects unsupported legacy contest-management payloads', () => {
    expect(() =>
      ContestConfigurationRequestSchema.parse({
        selectionType: 'PICK_EM',
      }),
    ).toThrow();
  });

  it('accepts template-first contest creation payloads', () => {
    const parsed = CreateContestManagementRequestSchema.parse({
      name: 'Masters Template Contest',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      contestFormat: 'ROSTER',
      templateId: '11111111-1111-4111-8111-111111111111',
    });

    expect('templateId' in parsed).toBe(true);
  });

  it('accepts template list query params and template dto payloads', () => {
    const query = ListContestConfigTemplatesQuerySchema.parse({
      sport: 'GOLF',
      contestFormat: 'ROSTER',
    });
    expect(query.sport).toBe('GOLF');

    const template = ContestConfigTemplateDtoSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      sport: 'GOLF',
      contestFormat: 'ROSTER',
      configMode: 'GOLF_TIERED',
      templateKey: 'golf-tiered-pick-6',
      name: 'Select one from each tier, 4 count',
      description: 'Default golf tiered template',
      sortOrder: 1,
      isDefault: true,
      active: true,
      schemaVersion: 1,
      configuration: {
        mode: 'GOLF_TIERED',
        locksAt: '2026-04-10T12:00:00.000Z',
        maxEntriesPerSquad: 1,
        rosterSize: 6,
        countedScores: 4,
        tierSource: 'ODDS',
        tierGeneration: {
          defaultTierSize: 10,
        },
        tiers: [
          {
            tierKey: 'A',
            label: 'Tier A',
            pickCount: 1,
            startPosition: 1,
            endPosition: 10,
          },
        ],
        cutRule: {
          type: 'FIXED_SCORE',
          fixedScore: 80,
        },
        playoffHandling: 'EXCLUDE_PLAYOFF_HOLES',
        displayScoring: 'TO_PAR',
        tiebreaker: {
          type: 'PREDICT_WINNING_SCORE',
        },
      },
    });

    expect(template.name).toContain('Select one');
  });

  // pool-master-41t — the commissioner management detail echoes the linked
  // event's effective tiers read-only (plans/124 §4.6/§5.3).
  it('accepts a management detail response carrying the read-only effectiveTiers echo', () => {
    const parsed = ContestManagementResponseSchema.parse({
      contest: {
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        name: 'Masters Pick 6',
        status: 'OPEN',
        configuration: {
          id: 'config-1',
          contestId: 'contest-1',
          mode: 'GOLF_TIERED',
          locksAt: '2026-04-10T12:00:00.000Z',
          maxEntriesPerSquad: 1,
          rosterSize: 6,
          countedScores: 4,
        },
        effectiveTiers: [
          {
            tierKey: 'tier-1',
            label: 'Tier 1',
            tierNumber: 1,
            defaultPickCount: 1,
            assignments: [
              {
                sportEventParticipantId: 'sep-1',
                participantId: 'golfer-1',
                tierOrderIndex: 1,
                price: null,
              },
            ],
          },
        ],
        createdAt: '2026-04-07T12:00:00.000Z',
        updatedAt: '2026-04-07T12:00:00.000Z',
      },
    });

    expect(parsed.contest.effectiveTiers).toHaveLength(1);
    expect(parsed.contest.effectiveTiers[0].assignments[0].participantId).toBe('golfer-1');
  });

  it('requires effectiveTiers on the management detail response', () => {
    expect(() =>
      ContestManagementResponseSchema.parse({
        contest: {
          id: 'contest-1',
          leagueId: 'league-1',
          sportEventId: '11111111-1111-1111-1111-111111111111',
          name: 'Masters Pick 6',
          status: 'OPEN',
          configuration: {
            id: 'config-1',
            contestId: 'contest-1',
            mode: 'GOLF_TIERED',
            locksAt: '2026-04-10T12:00:00.000Z',
            maxEntriesPerSquad: 1,
            rosterSize: 6,
            countedScores: 4,
          },
          createdAt: '2026-04-07T12:00:00.000Z',
          updatedAt: '2026-04-07T12:00:00.000Z',
        },
      }),
    ).toThrow();
  });
});
