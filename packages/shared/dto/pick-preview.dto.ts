/**
 * Pick preview DTOs (#1612): the member pick screen for a contest setup that is not saved yet,
 * built from the setup's rules and the picks the commissioner taps to try it. Nothing is stored.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  BracketContestRulesSchema,
  BudgetContestRulesSchema,
  PickEmContestRulesSchema,
  SurvivorContestRulesSchema,
  TieredContestRulesSchema,
} from '../domain/contest-rules';
import { PickEmMode, SelectionType } from '../domain/enums';
import { SelectionBudgetLineupSummaryDtoSchema, SelectionGroupDtoSchema } from './selections.dto';
import { GamePickDtoSchema, GamePickGameDtoSchema, GamePickWriteSchema } from './predictions.dto';

/** The most trial picks one preview read takes: a budget roster's ceiling is well under it. */
export const PICK_PREVIEW_PICKS_MAX = 200;

// --- Roster setups: tiered and budget ---

export const RosterPickPreviewRequestSchema = z.object({
  sportEventId: z.uuid().describe('The event the setup is for: its field, tiers and prices are the ones shown.'),
  rules: z.discriminatedUnion('selectionType', [TieredContestRulesSchema, BudgetContestRulesSchema])
    .describe('The setup\'s rules as the form holds them now, unsaved: a tiered or a budget setup.'),
  sportEventParticipantIds: z.array(z.uuid()).max(PICK_PREVIEW_PICKS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each golfer is picked at most once.' })
    .describe('The field rows the commissioner has tapped so far, as an entry\'s picks would be. Empty for the screen as a member first sees it.'),
}).describe('Request payload for previewing a roster setup\'s pick screen.');
export type RosterPickPreviewRequest = z.infer<typeof RosterPickPreviewRequestSchema>;

export const RosterPickPreviewResponseSchema = z.object({
  sportEventId: z.uuid(),
  selectionType: z.enum([SelectionType.TIERED, SelectionType.BUDGET_PICK]),
  rosterSize: z.number().int().describe('How many picks an entry makes under these rules: the tiers used times picks per tier, or the budget roster.'),
  selectionGroups: z.array(SelectionGroupDtoSchema).describe('The field as members pick from it: one group per tier, or the whole field dearest first in a budget setup. The trial picks are marked selected.'),
  availableParticipantIds: z.array(z.uuid()).describe('The field rows that can be picked: every row not withdrawn.'),
  pickCount: z.number().int().describe('How many of the trial picks are in the event\'s field.'),
  isComplete: z.boolean().describe('Whether the trial picks make a lineup an entry could submit: the full roster, each tier\'s picks, and in a budget setup within the salary cap.'),
  lineupSummary: SelectionBudgetLineupSummaryDtoSchema.nullable().describe('A budget setup\'s spend of the trial picks against the event\'s salary cap; null in a tiered setup.'),
}).describe('A roster setup\'s pick screen as members would see it, with the trial picks on it. Nothing is saved.');
export type RosterPickPreviewResponse = z.infer<typeof RosterPickPreviewResponseSchema>;

// --- Game setups: pick'em, bracket and survivor ---

export const GamePickPreviewRequestSchema = z.object({
  sportEventId: z.uuid().describe('The event the setup is for: its games and lines are the ones shown.'),
  rules: z.discriminatedUnion('selectionType', [
    PickEmContestRulesSchema,
    BracketContestRulesSchema,
    // Last, as in every rules union: see the note above `ContestRulesSchema`.
    SurvivorContestRulesSchema,
  ]).describe('The setup\'s rules as the form holds them now, unsaved: a pick\'em, bracket or survivor setup.'),
  picks: z.array(GamePickWriteSchema).max(PICK_PREVIEW_PICKS_MAX)
    .refine((picks) => new Set(picks.map((pick) => pick.sportEventMatchId)).size === picks.length, {
      message: 'Each game is picked at most once.',
    })
    .describe('The picks the commissioner has tapped so far, one per game, as an entry\'s would be. Empty for the screen as a member first sees it.'),
}).describe('Request payload for previewing a game setup\'s pick screen.');
export type GamePickPreviewRequest = z.infer<typeof GamePickPreviewRequestSchema>;

export const GamePickPreviewPickDtoSchema = GamePickDtoSchema.pick({
  predictedResult: true,
  sportEventParticipantId: true,
  confidence: true,
}).describe('A trial pick on one game, as it stands under the setup\'s rules.');
export type GamePickPreviewPickDto = z.infer<typeof GamePickPreviewPickDtoSchema>;

export const GamePickPreviewGameDtoSchema = GamePickGameDtoSchema.omit({ pick: true, revealed: true }).extend({
  locked: z.boolean().describe('Whether the game\'s pick would already be closed once the contest opens: it has kicked off, or in a bracket the starting round has.'),
  pick: GamePickPreviewPickDtoSchema.nullable().describe('The trial pick on the game; null when there is none, or it no longer stands (in a bracket, a later pick whose team an earlier trial pick knocked out).'),
}).describe('One game of the event with the trial pick on it.');
export type GamePickPreviewGameDto = z.infer<typeof GamePickPreviewGameDtoSchema>;

export const GamePickPreviewResponseSchema = z.object({
  sportEventId: z.uuid(),
  selectionType: z.enum([SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR]),
  mode: z.enum(PickEmMode).nullable().describe('A pick\'em setup\'s mode; null in a bracket or survivor setup.'),
  againstTheSpread: z.boolean().describe('Whether picks would be scored against each game\'s spread. Only a pick\'em setup can be.'),
  tiePicksOffered: z.boolean().describe('Whether a pick may say the game ends level (#792): a pick\'em setup in a sport that offers tie picks.'),
  pickedCount: z.number().int().describe('How many games hold a trial pick that stands.'),
  gameCount: z.number().int(),
  tiebreakerMatchId: z.uuid().nullable().describe('The game an entry\'s tiebreaker would guess the total points of: a bracket\'s final, a pick\'em week\'s last game. Null where there is none.'),
  games: z.array(GamePickPreviewGameDtoSchema).describe('The games an entry would pick, in game-number order: cancelled games left out, a bracket\'s from its starting round.'),
}).describe('A game setup\'s pick screen as members would see it, with the trial picks on it. Nothing is saved.');
export type GamePickPreviewResponse = z.infer<typeof GamePickPreviewResponseSchema>;

registerSchema('RosterPickPreviewRequest', RosterPickPreviewRequestSchema);
registerSchema('RosterPickPreviewResponse', RosterPickPreviewResponseSchema);
registerSchema('GamePickPreviewRequest', GamePickPreviewRequestSchema);
registerSchema('GamePickPreviewResponse', GamePickPreviewResponseSchema);
