import {
  ContestConfigTemplateDtoSchema,
  ContestConfigurationRequestSchema,
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

    if (!('configuration' in parsed)) {
      throw new Error('Expected legacy configuration payload');
    }
    expect(parsed.configuration.mode).toBe('GOLF_TIERED');
    if (parsed.configuration.mode !== 'GOLF_TIERED') {
      throw new Error('Expected golf tiered configuration');
    }
    expect(parsed.configuration.tiers).toHaveLength(1);
    expect(parsed.configuration.cutRule.fixedScore).toBe(80);
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
});
