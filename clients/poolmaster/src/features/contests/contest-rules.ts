import { SelectionType, getTieredRosterSize, type ContestRules, type SportNoun } from '@poolmaster/shared/domain';
import { formatDollars } from '@/features/shared/ui';

/**
 * The name a commissioner and a member read for each way of picking. A `Record` over the enum,
 * so adding a selection type without a name fails the typecheck.
 */
const SELECTION_TYPE_NAMES: Record<SelectionType, string> = {
  TIERED: 'Tiered',
  BUDGET_PICK: 'Budget',
  RANDOM_DRAW: 'Random draw',
};

export function formatSelectionTypeName(selectionType: SelectionType) {
  return SELECTION_TYPE_NAMES[selectionType];
}

/** "1 golfer", "6 golfers": a count with its noun. */
export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "1 horse", "6 horses": a count of the event's participants, in its sport's words. */
export function countParticipants(count: number, participant: SportNoun) {
  return pluralize(count, participant.one, participant.many);
}

type TieredRules = Extract<ContestRules, { selectionType: typeof SelectionType.TIERED }>;
type BudgetRules = Extract<ContestRules, { selectionType: typeof SelectionType.BUDGET_PICK }>;
type RandomDrawRules = Extract<ContestRules, { selectionType: typeof SelectionType.RANDOM_DRAW }>;

/** "Every score counts.", "The best score counts." or "The best 4 scores count." */
function formatCountedScores(countedScores: number, rosterSize: number | null) {
  return rosterSize !== null && countedScores >= rosterSize
    ? 'Every score counts.'
    : countedScores === 1
      ? 'The best score counts.'
      : `The best ${countedScores} scores count.`;
}

function formatTieredRules({ countedScores, picksPerTier }: TieredRules, tierCount: number, participant: SportNoun) {
  const golfers = countParticipants(picksPerTier, participant);
  const pick = tierCount === 0
    ? `Pick ${golfers} from each of the event's tiers.`
    : tierCount === 1
      ? `Pick ${golfers} from the event's one tier.`
      : `Pick ${golfers} from each of ${tierCount} tiers.`;
  const rosterSize = tierCount > 0 ? getTieredRosterSize(tierCount, picksPerTier) : null;
  return `${pick} ${formatCountedScores(countedScores, rosterSize)}`;
}

function formatBudgetRules({ countedScores, rosterSize }: BudgetRules, salaryCap: number | null, participant: SportNoun) {
  const cap = salaryCap === null ? 'the salary cap' : `the ${formatDollars(salaryCap)} salary cap`;
  return `Pick ${countParticipants(rosterSize, participant)} whose prices fit under ${cap}. ${formatCountedScores(countedScores, rosterSize)}`;
}

function formatRandomDrawRules({ countedScores, picksPerEntry }: RandomDrawRules, participant: SportNoun) {
  return `The draw deals each entry ${countParticipants(picksPerEntry, participant)} at random. ${formatCountedScores(countedScores, picksPerEntry)}`;
}

/** "Pick 6, best 4" or "Pick 6, all count": a roster size and the scores that count. */
function formatRosterLabel(verb: string, rosterSize: number, countedScores: number) {
  return `${verb} ${rosterSize}, ${countedScores >= rosterSize ? 'all count' : `best ${countedScores}`}`;
}

/**
 * A contest's rules as one plain sentence, such as "Pick 1 golfer from each of 6 tiers. The best
 * 4 scores count." Keyed by selection type, so each new way of picking adds its own arm here.
 * `tierCount` is the event's; an event with no tiers yet still reads sensibly. `participant` is
 * what the event's sport calls a competitor. `salaryCap` is the event's too, named in a budget
 * sentence when it is known.
 */
export function formatContestRules(
  configuration: ContestRules,
  tierCount: number,
  participant: SportNoun,
  salaryCap: number | null = null,
) {
  switch (configuration.selectionType) {
    case SelectionType.TIERED:
      return formatTieredRules(configuration, tierCount, participant);
    case SelectionType.BUDGET_PICK:
      return formatBudgetRules(configuration, salaryCap, participant);
    case SelectionType.RANDOM_DRAW:
      return formatRandomDrawRules(configuration, participant);
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
export function formatPresetLabel(configuration: ContestRules, tierCount: number) {
  switch (configuration.selectionType) {
    case SelectionType.TIERED: {
      const pick = tierCount > 0
        ? `Pick ${getTieredRosterSize(tierCount, configuration.picksPerTier)}`
        : `${configuration.picksPerTier} per tier`;
      const count = tierCount > 0 && configuration.countedScores >= getTieredRosterSize(tierCount, configuration.picksPerTier)
        ? 'all count'
        : `best ${configuration.countedScores}`;
      return `${pick}, ${count}`;
    }
    case SelectionType.BUDGET_PICK:
      return formatRosterLabel('Pick', configuration.rosterSize, configuration.countedScores);
    case SelectionType.RANDOM_DRAW:
      return formatRosterLabel('Draw', configuration.picksPerEntry, configuration.countedScores);
  }
}

/**
 * The name Create contest suggests from the event and the rules, such as "The Masters Pick 6" or
 * "The Masters Budget Pick 6", or "The Masters Sweepstake" for a random draw, until the commissioner types their own.
 */
export function suggestContestName(
  eventName: string,
  selectionType: SelectionType,
  configuration: ContestRules | null,
  tierCount: number,
) {
  switch (selectionType) {
    case SelectionType.TIERED:
      return configuration?.selectionType === SelectionType.TIERED && tierCount > 0
        ? `${eventName} Pick ${getTieredRosterSize(tierCount, configuration.picksPerTier)}`
        : `${eventName} Tiered`;
    case SelectionType.BUDGET_PICK:
      return configuration?.selectionType === SelectionType.BUDGET_PICK
        ? `${eventName} Budget Pick ${configuration.rosterSize}`
        : `${eventName} Budget`;
    case SelectionType.RANDOM_DRAW:
      return `${eventName} Sweepstake`;
  }
}
