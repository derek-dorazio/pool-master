import { SelectionType, getTieredRosterSize } from '@poolmaster/shared/domain';
import type { ContestConfigurationRequest } from '@poolmaster/shared/dto';

/**
 * The name a commissioner and a member read for each way of picking. A `Record` over the enum,
 * so adding a selection type without a name fails the typecheck.
 */
const SELECTION_TYPE_NAMES: Record<SelectionType, string> = {
  SNAKE_DRAFT: 'Snake draft',
  TIERED: 'Tiered',
  BUDGET_PICK: 'Budget',
  OPEN_SELECTION: 'Open selection',
  PICK_EM: "Pick'em",
  BRACKET_PICK_EM: "Bracket pick'em",
};

export function formatSelectionTypeName(selectionType: SelectionType) {
  return SELECTION_TYPE_NAMES[selectionType];
}

type ContestRulesConfiguration = Pick<ContestConfigurationRequest, 'countedScores' | 'picksPerTier'>;

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatTieredRules({ countedScores, picksPerTier }: ContestRulesConfiguration, tierCount: number) {
  const golfers = pluralize(picksPerTier, 'golfer');
  const pick = tierCount === 0
    ? `Pick ${golfers} from each of the event's tiers.`
    : tierCount === 1
      ? `Pick ${golfers} from the event's one tier.`
      : `Pick ${golfers} from each of ${tierCount} tiers.`;
  const rosterSize = getTieredRosterSize(tierCount, picksPerTier);
  const count = tierCount > 0 && countedScores >= rosterSize
    ? 'Every score counts.'
    : countedScores === 1
      ? 'The best score counts.'
      : `The best ${countedScores} scores count.`;
  return `${pick} ${count}`;
}

/**
 * A contest's rules as one plain sentence, such as "Pick 1 golfer from each of 6 tiers. The best
 * 4 scores count." Keyed by selection type, so each new way of picking adds its own arm here.
 * `tierCount` is the event's; an event with no tiers yet still reads sensibly.
 */
export function formatContestRules(
  selectionType: SelectionType,
  configuration: ContestRulesConfiguration,
  tierCount: number,
) {
  switch (selectionType) {
    case SelectionType.TIERED:
      return formatTieredRules(configuration, tierCount);
    default:
      return `${formatSelectionTypeName(selectionType)} contest.`;
  }
}

/** How many entries a team may make: a number, or "No limit" when the contest sets none. */
export function formatEntriesPerTeam(maxEntriesPerSquad: number | null | undefined) {
  return maxEntriesPerSquad == null ? 'No limit' : String(maxEntriesPerSquad);
}

/** "1 entry per team", "3 entries per team" or "No limit on entries per team", for a sentence. */
export function formatEntriesPerTeamSentence(maxEntriesPerSquad: number | null | undefined) {
  if (maxEntriesPerSquad == null) {
    return 'No limit on entries per team';
  }
  return `${pluralize(maxEntriesPerSquad, 'entry', 'entries')} per team`;
}

/**
 * A preset's short label for the "Start from" choice, such as "Pick 6, best 4" on an event with
 * six tiers. Before the event has tiers it reads per tier: "1 per tier, best 4".
 */
export function formatPresetLabel(
  selectionType: SelectionType,
  configuration: ContestRulesConfiguration,
  tierCount: number,
) {
  switch (selectionType) {
    case SelectionType.TIERED: {
      const pick = tierCount > 0
        ? `Pick ${getTieredRosterSize(tierCount, configuration.picksPerTier)}`
        : `${configuration.picksPerTier} per tier`;
      const count = tierCount > 0 && configuration.countedScores >= getTieredRosterSize(tierCount, configuration.picksPerTier)
        ? 'all count'
        : `best ${configuration.countedScores}`;
      return `${pick}, ${count}`;
    }
    default:
      return formatSelectionTypeName(selectionType);
  }
}

/**
 * The name Create contest suggests from the event and the rules, such as "The Masters Pick 6",
 * until the commissioner types their own.
 */
export function suggestContestName(
  eventName: string,
  selectionType: SelectionType,
  configuration: Pick<ContestRulesConfiguration, 'picksPerTier'> | null,
  tierCount: number,
) {
  switch (selectionType) {
    case SelectionType.TIERED:
      return configuration && tierCount > 0
        ? `${eventName} Pick ${getTieredRosterSize(tierCount, configuration.picksPerTier)}`
        : `${eventName} Tiered`;
    default:
      return `${eventName} ${formatSelectionTypeName(selectionType)}`;
  }
}
