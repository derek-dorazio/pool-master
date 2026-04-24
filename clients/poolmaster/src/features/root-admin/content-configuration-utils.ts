import type { AdminListContestConfigTemplatesResponses } from '@/lib/api';

export type ContestConfigTemplate = AdminListContestConfigTemplatesResponses[200]['templates'][number];

export function cloneContestTemplate(template: ContestConfigTemplate): ContestConfigTemplate {
  return {
    ...template,
    configuration: JSON.parse(JSON.stringify(template.configuration)) as ContestConfigTemplate['configuration'],
  };
}

export function toPositiveNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function buildTierLabel(index: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) {
    return `Tier ${alphabet[index]}`;
  }
  return `Tier ${index + 1}`;
}

function buildTierDefinitions(tierCount: number, picksPerTier: number, tierSize: number) {
  return Array.from({ length: tierCount }, (_, index) => {
    const startPosition = index * tierSize + 1;
    const endPosition = startPosition + tierSize - 1;

    return {
      tierKey: index < 26 ? String.fromCharCode(65 + index) : `T${index + 1}`,
      label: buildTierLabel(index),
      pickCount: picksPerTier,
      startPosition,
      endPosition,
    };
  });
}

export function getTierCount(template: ContestConfigTemplate) {
  if (template.configuration.mode !== 'GOLF_TIERED') {
    return 0;
  }

  return template.configuration.tiers.length;
}

export function getPicksPerTier(template: ContestConfigTemplate) {
  if (template.configuration.mode !== 'GOLF_TIERED') {
    return 0;
  }

  return template.configuration.tiers[0]?.pickCount ?? 1;
}

export function updateTieredTemplateConfiguration(
  template: ContestConfigTemplate,
  updates: {
    tierCount?: number;
    picksPerTier?: number;
    countedScores?: number;
    tierSize?: number;
    cutScore?: number;
  },
): ContestConfigTemplate {
  if (template.configuration.mode !== 'GOLF_TIERED') {
    return template;
  }

  const tierCount = updates.tierCount ?? getTierCount(template);
  const picksPerTier = updates.picksPerTier ?? getPicksPerTier(template);
  const tierSize = updates.tierSize ?? template.configuration.tierGeneration.defaultTierSize;
  const countedScores = updates.countedScores ?? template.configuration.countedScores;

  return {
    ...template,
    configuration: {
      ...template.configuration,
      countedScores,
      tierGeneration: {
        ...template.configuration.tierGeneration,
        defaultTierSize: tierSize,
      },
      tiers: buildTierDefinitions(tierCount, picksPerTier, tierSize),
      cutRule: {
        ...template.configuration.cutRule,
        fixedScore: updates.cutScore ?? template.configuration.cutRule.fixedScore,
      },
    },
  };
}
