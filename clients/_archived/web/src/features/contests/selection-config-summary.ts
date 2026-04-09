import { SelectionType } from '@poolmaster/shared/domain';

type SelectionConfigValue = Record<string, unknown> | null | undefined;

export interface SelectionDetailRow {
  label: string;
  value: string;
}

export function formatSelectionTypeLabel(selectionType: string) {
  switch (selectionType) {
    case SelectionType.SNAKE_DRAFT:
      return 'Snake Draft';
    case SelectionType.TIERED:
      return 'Tiered Pick';
    case SelectionType.BUDGET_PICK:
      return 'Budget Pick';
    case SelectionType.OPEN_SELECTION:
      return 'Open Selection';
    case SelectionType.PICK_EM:
      return "Pick'em";
    case SelectionType.BRACKET_PICK_EM:
      return "Bracket Pick'em";
    default:
      return selectionType;
  }
}

export function formatTierAssignmentMethodLabel(method: string) {
  switch (method) {
    case 'RANKING':
      return 'World Ranking';
    case 'SEED':
      return 'Seed';
    case 'ODDS':
      return 'Odds';
    case 'COMMISSIONER':
      return 'Commissioner Set';
    default:
      return method;
  }
}

export function formatPricingMethodLabel(method: string) {
  switch (method) {
    case 'RANKING':
      return 'World Ranking';
    case 'ODDS':
      return 'Odds';
    case 'SEED':
      return 'Seed';
    case 'SALARY_TABLE':
      return 'Salary Table';
    default:
      return method;
  }
}

function getTierCount(config: Record<string, unknown>) {
  if (typeof config.tierCount === 'number') {
    return config.tierCount;
  }

  if (Array.isArray(config.tierConfig)) {
    return config.tierConfig.length;
  }

  return null;
}

function getTierSize(config: Record<string, unknown>) {
  if (typeof config.tierSize === 'number') {
    return config.tierSize;
  }

  if (!Array.isArray(config.tierConfig) || config.tierConfig.length === 0) {
    return null;
  }

  const sizes = config.tierConfig
    .map((tier) => (
      tier && typeof tier === 'object' && typeof tier.maxParticipants === 'number'
        ? tier.maxParticipants
        : null
    ))
    .filter((value): value is number => value != null);

  if (sizes.length === 0) {
    return null;
  }

  return sizes.every((value) => value === sizes[0]) ? sizes[0] : null;
}

function getPicksPerTier(config: Record<string, unknown>) {
  if (typeof config.picksPerTier === 'number') {
    return config.picksPerTier;
  }

  if (!Array.isArray(config.tierConfig) || config.tierConfig.length === 0) {
    return null;
  }

  const picks = config.tierConfig
    .map((tier) => (
      tier && typeof tier === 'object' && typeof tier.picksFromTier === 'number'
        ? tier.picksFromTier
        : null
    ))
    .filter((value): value is number => value != null);

  if (picks.length === 0) {
    return null;
  }

  return picks.every((value) => value === picks[0]) ? picks[0] : null;
}

export function getSelectionConfigDetailRows(selectionConfig: SelectionConfigValue): SelectionDetailRow[] {
  if (!selectionConfig) return [];

  const rows: SelectionDetailRow[] = [];

  if (typeof selectionConfig.draftMode === 'string') {
    rows.push({ label: 'Draft Mode', value: selectionConfig.draftMode });
  }

  if (typeof selectionConfig.rounds === 'number') {
    rows.push({ label: 'Rounds', value: `${selectionConfig.rounds}` });
  }

  if (typeof selectionConfig.budget === 'number') {
    rows.push({ label: 'Budget', value: `$${selectionConfig.budget.toLocaleString()}` });
  }

  if (typeof selectionConfig.rosterSize === 'number') {
    rows.push({ label: 'Roster Size', value: `${selectionConfig.rosterSize}` });
  }

  if (typeof selectionConfig.pickCount === 'number') {
    rows.push({ label: 'Pick Count', value: `${selectionConfig.pickCount}` });
  }

  if (typeof selectionConfig.pricingMethod === 'string') {
    rows.push({
      label: 'Pricing',
      value: formatPricingMethodLabel(selectionConfig.pricingMethod),
    });
  }

  if (typeof selectionConfig.tierAssignmentMethod === 'string') {
    rows.push({
      label: 'Tier Assignment',
      value: formatTierAssignmentMethodLabel(selectionConfig.tierAssignmentMethod),
    });
  }

  const tierCount = getTierCount(selectionConfig);
  if (tierCount != null) {
    rows.push({ label: 'Tier Count', value: `${tierCount}` });
  }

  const tierSize = getTierSize(selectionConfig);
  if (tierSize != null) {
    rows.push({ label: 'Tier Size', value: `${tierSize}` });
  }

  const picksPerTier = getPicksPerTier(selectionConfig);
  if (picksPerTier != null) {
    rows.push({ label: 'Picks Per Tier', value: `${picksPerTier}` });
  }

  if (typeof selectionConfig.bestBallN === 'number') {
    rows.push({ label: 'Best Ball', value: `Best ${selectionConfig.bestBallN} count` });
  }

  if (typeof selectionConfig.picksPerPeriod === 'number') {
    rows.push({ label: 'Picks Per Period', value: `${selectionConfig.picksPerPeriod}` });
  }

  if (typeof selectionConfig.strikesBeforeElimination === 'number') {
    rows.push({
      label: 'Strikes Before Elimination',
      value: `${selectionConfig.strikesBeforeElimination}`,
    });
  }

  if (typeof selectionConfig.survivorStyle === 'string') {
    rows.push({ label: 'Survivor Style', value: selectionConfig.survivorStyle });
  }

  return rows;
}

export function getSelectionConfigSummary(selectionConfig: SelectionConfigValue) {
  return getSelectionConfigDetailRows(selectionConfig).map((row) => `${row.label}: ${row.value}`);
}
