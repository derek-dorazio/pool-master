import type { LucideIcon } from 'lucide-react';
import { z } from 'zod';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import type { CreateContestRequest } from '@poolmaster/shared/dto';
import {
  ParticipantScoringDefinitionIdSchema,
  SUPPORTED_SPORTS,
  SelectionType,
  type Sport,
  type SportDefinition,
  type SportNoun,
  UpsetBonusRule,
  eventSportDefinition,
  getSportDefinition,
} from '@poolmaster/shared/domain';
import { hasWebEntryScreen, type WebEnterableSelectionType } from '../contest-entry-screens';
import { CONTEST_RULES_FORM_SHAPE } from '../contest-rules-form';
import { SELECTION_TYPE_ICONS } from '../selection-type-icons';

/**
 * The ways of picking Create contest can offer: the ones the create contract accepts whose
 * entries have a screen to pick on here.
 */
export type CreatableSelectionType = Extract<CreateContestRequest['selectionType'], WebEnterableSelectionType>;

/**
 * The ways of picking Create contest offers, one card each, with its own rules fields. A `Record`
 * over the creatable types, so a type that gains an entry screen must gain a card. Each card says
 * what it means in the sport's words.
 */
export const FORMAT_CHOICES: Record<CreatableSelectionType, { describe: (participant: SportNoun) => string; icon: LucideIcon }> = {
  [SelectionType.TIERED]: {
    icon: SELECTION_TYPE_ICONS.TIERED,
    describe: ({ many }) => `Pick ${many} from each of the event's tiers, so the favorites are spread across every entry.`,
  },
  [SelectionType.BUDGET_PICK]: {
    icon: SELECTION_TYPE_ICONS.BUDGET_PICK,
    describe: ({ one }) => `Every ${one} has a price. Pick a roster whose prices fit under the salary cap.`,
  },
  [SelectionType.RANDOM_DRAW]: {
    icon: SELECTION_TYPE_ICONS.RANDOM_DRAW,
    describe: ({ many }) => `A sweepstake: nobody picks. Once entries are in, you run the draw and each entry is dealt ${many} at random.`,
  },
  [SelectionType.PICK_EM]: {
    icon: SELECTION_TYPE_ICONS.PICK_EM,
    describe: () => 'Pick the winner of every game, week by week, straight up or ranked by confidence. Add the season\'s other weeks once the contest is created.',
  },
  [SelectionType.BRACKET]: {
    icon: SELECTION_TYPE_ICONS.BRACKET,
    describe: () => 'Pick the winner of every game, all the way to the final: the whole bracket before it starts, or a second-chance bracket from a later round.',
  },
  [SelectionType.SURVIVOR]: {
    icon: SELECTION_TYPE_ICONS.SURVIVOR,
    describe: () => 'Pick one team to win each week, never the same team twice. A loss puts the entry out; the last ones standing win. Add the season\'s other weeks once the contest is created.',
  },
  [SelectionType.SQUARES]: {
    icon: SELECTION_TYPE_ICONS.SQUARES,
    describe: () => 'A 10x10 grid on one game. Members claim boxes, you draw the numbers, and the box matching each team\'s last digit wins each quarter and the final score.',
  },
};

/** The definition of the event the form has chosen, else its sport's (#936). */
export function definitionOfEvent(sport: Sport, events: readonly SportEventDto[] | undefined, sportEventId: string): SportDefinition {
  const event = events?.find((candidate) => candidate.id === sportEventId);
  return event ? eventSportDefinition(event) : getSportDefinition(sport);
}

/**
 * The formats a sport's contests may use, in its definition's order: those whose entries have a
 * screen to pick on here.
 */
export function formatChoicesFor(sport: SportDefinition) {
  return sport.selectionTypes
    .filter(hasWebEntryScreen)
    .map((selectionType) => ({ selectionType, ...FORMAT_CHOICES[selectionType] }));
}

export const creatableSelectionTypes = Object.values(SelectionType).filter(hasWebEntryScreen) as [
  CreatableSelectionType,
  ...CreatableSelectionType[],
];

export function isCreatableSelectionType(selectionType: SelectionType): selectionType is CreatableSelectionType {
  return creatableSelectionTypes.some((creatable) => creatable === selectionType);
}

export const createContestFormSchema = z.object({
  ...CONTEST_RULES_FORM_SHAPE,
  contestName: z.string().trim().min(1, 'Contest name is required.'),
  didNotFinishPoints: z.string(),
  pointsTable: z.string(),
  roundValues: z.string(),
  scoringDefinitionId: ParticipantScoringDefinitionIdSchema,
  selectedTemplateId: z.string(),
  selectionType: z.enum(creatableSelectionTypes),
  sport: z.custom<Sport>((value) => SUPPORTED_SPORTS.some((sport) => sport === value)),
  sportEventId: z.string().min(1, 'Choose an event for the contest.'),
  /** The game a squares contest is played on (#711); empty for every other format. */
  sportEventMatchId: z.string(),
  upsetBonusMultiplier: z.string(),
  upsetBonusRule: z.enum([UpsetBonusRule.NONE, UpsetBonusRule.SEED_DIFFERENCE]),
});

export type CreateContestFormValues = z.infer<typeof createContestFormSchema>;

/**
 * A format's starting preset: the event's sport league's own default over the sport-wide default,
 * else the first. The list holds only that league's templates and the sport-wide ones, so a
 * template with a sport league is the event's league's.
 */
export function defaultPresetOf<Preset extends Pick<ContestConfigTemplateDto, 'isDefault' | 'sportLeagueId'>>(presets: Preset[]) {
  return presets.find((template) => template.isDefault && template.sportLeagueId !== null)
    ?? presets.find((template) => template.isDefault)
    ?? presets.at(0);
}

/**
 * The format an event's sport league starts on: the format of its first default by sort order
 * among the ones the page creates and the event can take (#802: a league has a default for each
 * format, and sorts the one to start on first, such as Formula 1's budget contest, #625). Null when
 * the league has no default of its own, and the format chosen stays.
 */
export function leagueStartingFormatOf(
  templates: ContestConfigTemplateDto[],
  isAvailable: (format: CreatableSelectionType) => boolean,
): CreatableSelectionType | null {
  const formats = templates
    .filter((template) => template.isDefault && template.sportLeagueId !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((template) => template.selectionType)
    .filter((format): format is CreatableSelectionType => hasWebEntryScreen(format) && isAvailable(format));
  return formats.at(0) ?? null;
}
