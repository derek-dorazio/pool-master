import { PickEmMode, SelectionType, getTieredRosterSize, type ContestRules, type SportNoun } from '@poolmaster/shared/domain';
import { formatDollars } from '@/features/shared/ui';

/**
 * The name a commissioner and a member read for each way of picking. A `Record` over the enum,
 * so adding a selection type without a name fails the typecheck.
 */
const SELECTION_TYPE_NAMES: Record<SelectionType, string> = {
  TIERED: 'Tiered',
  BUDGET_PICK: 'Budget',
  RANDOM_DRAW: 'Random draw',
  PICK_EM: 'Pick’em',
  BRACKET: 'Bracket',
};

export function formatSelectionTypeName(selectionType: SelectionType) {
  return SELECTION_TYPE_NAMES[selectionType];
}

/** What each pick'em mode is called: whether an entry also ranks its picks by confidence. */
const PICK_EM_MODE_NAMES: Record<PickEmMode, string> = {
  STRAIGHT_UP: 'Straight up',
  CONFIDENCE: 'Confidence',
};

export function formatPickEmModeName(mode: PickEmMode) {
  return PICK_EM_MODE_NAMES[mode];
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

/** A pick'em contest's rules: the winner of every game and, in confidence mode, a rank for each. */
export function describePickEmMode(mode: PickEmMode) {
  return mode === PickEmMode.CONFIDENCE
    ? 'Pick the winner of every game, then rank each week’s picks by confidence.'
    : 'Pick the winner of every game.';
}

/** A round of a knockout event by its number, in the event's words: "Sweet 16", "Divisional Round". */
export type RoundName = (roundNumber: number) => string;

/** Until an event's round names are known, a round reads by its number. */
const numberedRoundName: RoundName = (roundNumber) => `Round ${roundNumber}`;

/** Whether a bracket starting at this round is a second-chance bracket (#721): any round after the first. */
export function isSecondChanceBracket(startsAtRound: number) {
  return startsAtRound > 1;
}

/**
 * A bracket contest's rules (#721): every game picked to the final before the first game, or for
 * a second-chance bracket, every game from its starting round on, before that round's first game.
 * `startRoundName` is that round's name, or null for a full bracket.
 */
export function describeBracketRules(startRoundName: string | null = null) {
  return startRoundName === null
    ? 'Fill in the whole bracket before the first game: pick the winner of every game, all the way to the final.'
    : `Second-chance bracket from the ${startRoundName}: pick the winner of every game from the ${startRoundName} on, all the way to the final, before its first game.`;
}

/** "Full bracket" or "From the Sweet 16": where a bracket starts, as its choice reads. */
export function formatBracketStartLabel(startsAtRound: number, roundName: RoundName) {
  return isSecondChanceBracket(startsAtRound) ? `From the ${roundName(startsAtRound)}` : 'Full bracket';
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
 * sentence when it is known. `roundName` names a second-chance bracket's starting round.
 */
export function formatContestRules(
  configuration: ContestRules,
  tierCount: number,
  participant: SportNoun,
  salaryCap: number | null = null,
  roundName: RoundName = numberedRoundName,
) {
  switch (configuration.selectionType) {
    case SelectionType.TIERED:
      return formatTieredRules(configuration, tierCount, participant);
    case SelectionType.BUDGET_PICK:
      return formatBudgetRules(configuration, salaryCap, participant);
    case SelectionType.RANDOM_DRAW:
      return formatRandomDrawRules(configuration, participant);
    case SelectionType.PICK_EM:
      return describePickEmMode(configuration.mode);
    case SelectionType.BRACKET:
      return describeBracketRules(isSecondChanceBracket(configuration.startsAtRound) ? roundName(configuration.startsAtRound) : null);
  }
}

/** How many entries a team may make: a number, or "No limit" when the contest sets none. */
export function formatEntriesPerTeam(maxEntriesPerSquad: number | null | undefined) {
  return maxEntriesPerSquad == null ? 'No limit' : String(maxEntriesPerSquad);
}

/** "1 entry per member", "3 entries per member" or "No limit on entries per member", for a sentence. */
export function formatEntriesPerTeamSentence(maxEntriesPerSquad: number | null | undefined) {
  if (maxEntriesPerSquad == null) {
    return 'No limit on entries per member';
  }
  return `${pluralize(maxEntriesPerSquad, 'entry', 'entries')} per member`;
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
    case SelectionType.PICK_EM:
      return formatPickEmModeName(configuration.mode);
    case SelectionType.BRACKET:
      return isSecondChanceBracket(configuration.startsAtRound) ? 'Second chance' : formatSelectionTypeName(SelectionType.BRACKET);
  }
}

/**
 * The name Create contest suggests from the event and the rules, such as "The Masters Pick 6" or
 * "The Masters Budget Pick 6", "The Masters Sweepstake" for a random draw, "NFL Week 1 Pick'em",
 * "March Madness Bracket" or "March Madness Second-Chance Bracket", until the commissioner types
 * their own.
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
    case SelectionType.PICK_EM:
      return `${eventName} Pick’em`;
    case SelectionType.BRACKET:
      return configuration?.selectionType === SelectionType.BRACKET && isSecondChanceBracket(configuration.startsAtRound)
        ? `${eventName} Second-Chance Bracket`
        : `${eventName} Bracket`;
  }
}
