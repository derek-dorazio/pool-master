import { expect } from '@jest/globals';
import {
  ContestConfigTemplateDtoSchema,
  ContestConfigurationRequestSchema,
  ContestManagementResponseSchema,
  CONTEST_CONFIGURATION_REQUIRED,
  CreateContestRequestSchema,
  ListContestConfigTemplatesQuerySchema,
} from '../../../packages/shared/dto';

describe('contest-management dto schemas', () => {
  it('accepts a create carrying a configuration and no template', () => {
    const parsed = CreateContestRequestSchema.parse({
      name: 'Masters Pick 6',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      configuration: {
        maxEntriesPerSquad: 3,
        selectionType: 'TIERED',
        picksPerTier: 1,
        countedScores: 4,
      },
    });

    expect(parsed.configuration).toMatchObject({ selectionType: 'TIERED', picksPerTier: 1 });
    expect(parsed.templateId).toBeUndefined();
  });

  it('rejects unsupported legacy contest-management payloads', () => {
    expect(() =>
      ContestConfigurationRequestSchema.parse({
        selectionType: 'PICK_EM',
      }),
    ).toThrow();
  });

  it('accepts a create naming a template and no configuration', () => {
    const parsed = CreateContestRequestSchema.parse({
      name: 'Masters Template Contest',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      templateId: '11111111-1111-4111-8111-111111111111',
    });

    expect(parsed.templateId).toBe('11111111-1111-4111-8111-111111111111');
  });

  // #245 — the one structural rule JSON Schema cannot carry: at least one of the two.
  it('refuses a create naming neither a template nor a configuration, with the documented code', () => {
    const result = CreateContestRequestSchema.safeParse({
      name: 'Empty',
      sportEventId: '11111111-1111-1111-1111-111111111111',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        params: expect.objectContaining({ code: CONTEST_CONFIGURATION_REQUIRED }),
      }),
    ]);
  });

  it('refuses a selection type that has no typed rules yet', () => {
    expect(
      CreateContestRequestSchema.safeParse({
        name: 'Pick em',
        sportEventId: '11111111-1111-1111-1111-111111111111',
        contestFormat: 'ROSTER',
        selectionType: 'PICK_EM',
        templateId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });

  it('accepts budget rules of a roster size and counted scores, dropping a salary cap the commissioner may not set', () => {
    const parsed = ContestConfigurationRequestSchema.parse({
      selectionType: 'BUDGET_PICK',
      rosterSize: 6,
      countedScores: 4,
      salaryCap: 1_000_000,
    });

    expect(parsed).toEqual({ selectionType: 'BUDGET_PICK', rosterSize: 6, countedScores: 4 });
  });

  it('refuses a budget roster above twelve golfers', () => {
    expect(ContestConfigurationRequestSchema.safeParse({ selectionType: 'BUDGET_PICK', rosterSize: 13, countedScores: 4 }).success)
      .toBe(false);
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
      selectionType: 'TIERED',
      templateKey: 'golf-tiered-pick-6',
      name: 'Select one from each tier, 4 count',
      description: 'Default golf tiered template',
      sortOrder: 1,
      isDefault: true,
      active: true,
      schemaVersion: 1,
      configuration: {
        maxEntriesPerSquad: 1,
        selectionType: 'TIERED',
        picksPerTier: 1,
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
          maxEntriesPerSquad: 1,
          selectionType: 'TIERED',
          picksPerTier: 1,
          countedScores: 4,
        },
        effectiveTiers: [
          {
            tierKey: 'tier-1',
            label: 'Tier 1',
            tierNumber: 1,
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
            maxEntriesPerSquad: 1,
            selectionType: 'TIERED',
            picksPerTier: 1,
            countedScores: 4,
          },
          createdAt: '2026-04-07T12:00:00.000Z',
          updatedAt: '2026-04-07T12:00:00.000Z',
        },
      }),
    ).toThrow();
  });
});
