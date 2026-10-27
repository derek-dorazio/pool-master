/**
 * Game-pick DTOs (#716): a prediction contest entry's picks on one event's games, and the
 * requests that change and submit them.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { ContestEntryStatus, MatchStatus, PickEmMode, PickOutcome, PredictedResult, SelectionType, SportEventStatus, SurvivorWeekOutcome } from '../domain/enums';

// --- Requests ---

export const GamePickWriteSchema = z.object({
  sportEventMatchId: z.uuid().describe('The game picked: one of the event\'s games.'),
  predictedResult: z.enum(PredictedResult).describe('What the pick says happens: TEAM, the team named wins; TIE, the game ends level (#792). Only a pick\'em pool whose sport offers tie picks (`tiePicksOffered`) takes a TIE.'),
  sportEventParticipantId: z.uuid().nullable().describe('With TEAM, the team picked to win: the field row of one of the two teams the game offers the entry. In a bracket a later game offers the teams the entry picked to win the games before it. Null with TIE.'),
  confidence: z.number().int().min(1).nullable().optional().describe('A confidence pool\'s value for this pick, 1 to the week\'s number of games. Omitted or null in a straight-up pool, and until the entry gives one. A value may repeat until the week is submitted.'),
}).refine((pick) => (pick.predictedResult === PredictedResult.TEAM) === (pick.sportEventParticipantId !== null), {
  message: 'A TEAM pick names its team, and a TIE pick names none.',
}).describe('One game\'s pick as it is saved.');
export type GamePickWrite = z.infer<typeof GamePickWriteSchema>;

/** The highest tiebreaker guess taken: a final's combined score is well under it in every sport. */
export const GAME_PICKS_TIEBREAKER_MAX = 999;

export const SaveGamePicksRequestSchema = z.object({
  picks: z.array(GamePickWriteSchema)
    .refine((picks) => new Set(picks.map((pick) => pick.sportEventMatchId)).size === picks.length, {
      message: 'Each game is picked at most once per request.',
    })
    .describe('The picks to save, one per game; may be empty when only the tiebreaker changes. Each replaces the entry\'s pick on that game; the entry\'s other picks are kept, except that in a bracket a later pick that no longer follows from the entry\'s picks is cleared, and in a survivor pool, which takes one pick, the entry\'s pick on another game is cleared. Saved together or not at all, so two confidence values can be swapped, or a whole bracket filled, in one request.'),
  tiebreakerValue: z.number().int().min(0).max(GAME_PICKS_TIEBREAKER_MAX).nullable().optional()
    .describe('The event\'s tiebreaker: the total points the entry expects in its tiebreaker game (`tiebreakerMatchId`: a bracket\'s final, a pick\'em week\'s last game), both teams together. Required before submit; null clears it, omitted leaves it as it is. Refused with 409 CONTEST_ENTRY_LOCKED once that game\'s pick has locked.'),
}).describe('Request payload for saving an entry\'s picks on one event\'s games.');
export type SaveGamePicksRequest = z.infer<typeof SaveGamePicksRequestSchema>;

// --- Response ---

export const GamePickTeamDtoSchema = z.object({
  sportEventParticipantId: z.uuid().describe('The team\'s field row in the event: what a pick names.'),
  participantId: z.uuid(),
  name: z.string(),
}).describe('One team of a game.');
export type GamePickTeamDto = z.infer<typeof GamePickTeamDtoSchema>;

export const GamePickDtoSchema = z.object({
  predictedResult: z.enum(PredictedResult).describe('What the pick says happens: TEAM, its team wins; TIE, the game ends level (#792).'),
  sportEventParticipantId: z.uuid().nullable().describe('The team picked to win; null for a TIE pick.'),
  confidence: z.number().int().nullable().describe('The pick\'s confidence value; null in a straight-up pool, in a bracket, or until given.'),
  pickedAt: z.iso.datetime(),
  outcome: z.enum(PickOutcome).nullable().describe('How the pick stands against the results: CORRECT once its team won the game (in a bracket, its round; against the spread, covered), or for a TIE pick once the game ended level, BUSTED once it can no longer come true (a loss, a tie, a failure to cover, or in a bracket its team out), PUSH against the spread when the game landed exactly on it, else PENDING.'),
  points: z.number().int().nullable().describe('What the pick earned when CORRECT: in a bracket its round\'s value plus any upset bonus, in a pick\'em pool 1 point straight up or its confidence value. 0 when BUSTED or PUSH, null while PENDING or not scored.'),
}).describe('An entry\'s pick on one game.');
export type GamePickDto = z.infer<typeof GamePickDtoSchema>;

export const GamePickGameDtoSchema = z.object({
  sportEventMatchId: z.uuid(),
  matchNumber: z.number().int(),
  roundNumber: z.number().int(),
  kickoff: z.iso.datetime().describe('When the game starts: its scheduled time, else its event\'s start. Its pick locks then.'),
  status: z.enum(MatchStatus),
  isNeutralSite: z.boolean(),
  regionLabel: z.string().nullable().describe('The bracket region or conference the game is in ("East", "AFC"), for grouping on screen; null where the bracket has none.'),
  homeSpread: z.number().nullable().describe('The points spread from the home team\'s side (#720): -3.5 has the home team favoured by 3.5. Null until set.'),
  home: GamePickTeamDtoSchema.nullable().describe('The team really playing on this side; null until it is decided.'),
  away: GamePickTeamDtoSchema.nullable().describe('The team really playing on this side; null until it is decided.'),
  predictedHome: GamePickTeamDtoSchema.nullable().describe('The team the entry\'s own picks put on this side, which its pick chooses between: in a bracket, the team it picked to win the game feeding this side (in a reseeded round, its picked winners paired by seed); otherwise the real team. Null until the picks that decide it are made. On another team\'s entry, the real team until the game is revealed.'),
  predictedAway: GamePickTeamDtoSchema.nullable().describe('As predictedHome, for the away side.'),
  locked: z.boolean().describe('Whether the game\'s pick can no longer change: it has kicked off, or the contest no longer takes picks.'),
  revealed: z.boolean().describe('Whether picks on this game are shown to the whole league: from its kickoff once the contest is live.'),
  pick: GamePickDtoSchema.nullable().describe('The entry\'s pick on the game. Null when it has none, and on another team\'s entry until the game is revealed.'),
}).describe('One game of the event with the entry\'s pick on it.');
export type GamePickGameDto = z.infer<typeof GamePickGameDtoSchema>;

export const GamePicksSurvivorDtoSchema = z.object({
  eliminatedInWeek: z.number().int().nullable().describe('The week number (1 for the contest\'s first week) that put the entry out: a loss, a tie, or a week not submitted by its first kickoff. Null while it is still in. An entry that is out picks no later week.'),
  usedParticipantIds: z.array(z.uuid()).nullable().describe('The teams, by participant id, the entry picked in its other submitted weeks: it cannot pick them again. Null on another team\'s entry, as they could show picks not yet revealed.'),
}).describe('A survivor entry\'s season as one week sees it.');
export type GamePicksSurvivorDto = z.infer<typeof GamePicksSurvivorDtoSchema>;

export const GamePicksResponseSchema = z.object({
  contestId: z.uuid(),
  entryId: z.uuid(),
  entryName: z.string(),
  sportEventId: z.uuid(),
  selectionType: z.enum([SelectionType.PICK_EM, SelectionType.BRACKET, SelectionType.SURVIVOR]),
  mode: z.enum(PickEmMode).nullable().describe('A pick\'em pool\'s mode; null in a bracket or survivor pool.'),
  againstTheSpread: z.boolean().describe('Whether picks are scored against each game\'s spread: a pick names the team that covers. Only a pick\'em pool can be.'),
  tiePicksOffered: z.boolean().describe('Whether a pick may say the game ends level (#792): a pick\'em pool in a sport that offers tie picks, a draw in soccer. False in a bracket or survivor pool.'),
  survivor: GamePicksSurvivorDtoSchema.nullable().describe('A survivor pool\'s season for the entry; null in the other pools.'),
  status: z.enum(ContestEntryStatus).describe('The entry\'s status for this event: DRAFT while picking, SUBMITTED once every game is picked and submitted. Only a submitted event counts.'),
  submittedAt: z.iso.datetime().nullable(),
  ownEntry: z.boolean().describe('Whether the caller is on the entry\'s team, and so sees every pick on it.'),
  canSubmit: z.boolean().describe('Whether the caller can submit the event now: their own draft entry, every game picked with valid confidence values and the tiebreaker given, before the first game starts.'),
  pickedCount: z.number().int().describe('How many of the games have a pick. Counted on the caller\'s own entry; on another team\'s, only revealed games are counted.'),
  gameCount: z.number().int(),
  tiebreakerMatchId: z.uuid().nullable().describe('The game whose total points the tiebreaker guesses: a bracket\'s final, a pick\'em week\'s last game by kickoff. Null while there is none.'),
  tiebreakerValue: z.number().int().nullable().describe('The entry\'s tiebreaker for the event, the tiebreaker game\'s total points. Null when not given, and on another team\'s entry until that game\'s picks are revealed.'),
  points: z.number().int().nullable().describe('Points so far: a bracket\'s round values and upset bonuses, a pick\'em pick\'s 1 point, or its confidence value, for each correct pick. Null on another team\'s entry until all its picks are revealed.'),
  maxPossiblePoints: z.number().int().nullable().describe('Points so far plus what every pick still pending is worth: the most the entry can still reach. Null where points is.'),
  games: z.array(GamePickGameDtoSchema).describe('The event\'s games in game-number order. Cancelled games are left out: they are not picked.'),
}).describe('A prediction contest entry\'s picks on one event\'s games.');
export type GamePicksResponse = z.infer<typeof GamePicksResponseSchema>;

export const BracketLeaderboardEntryDtoSchema = z.object({
  entryId: z.uuid(),
  entryName: z.string(),
  entryNumber: z.number().int(),
  squadId: z.uuid(),
  squadName: z.string(),
  position: z.number().int().describe('The entry\'s place: by points, then, once the final is played, by how close its tiebreaker was to the final\'s total points. Entries still level share a place.'),
  displayPosition: z.string().describe('The place as shown, "T2" when shared.'),
  points: z.number().int().describe('Points so far: each correct pick\'s round value plus any upset bonus.'),
  maxPossiblePoints: z.number().int().describe('Points so far plus the round value of every pick whose team is still in: the most the entry can still reach.'),
  correctPickCount: z.number().int(),
  tiebreakerValue: z.number().int().nullable().describe('The entry\'s guess of the final\'s total points.'),
}).describe('One entry\'s standing in a bracket contest.');
export type BracketLeaderboardEntryDto = z.infer<typeof BracketLeaderboardEntryDtoSchema>;

export const BracketLeaderboardResponseSchema = z.object({
  contestId: z.uuid(),
  sportEventId: z.uuid(),
  eventCancelled: z.boolean().describe('The event was cancelled: it counts for nothing, so every entry stands unscored and no game counts.'),
  gameCount: z.number().int().describe('The bracket\'s games: an entry picks each one. None when the event was cancelled.'),
  finalTotalPoints: z.number().int().nullable().describe('The final\'s combined score, both teams together, once it is played: what the tiebreakers are measured against.'),
  entries: z.array(BracketLeaderboardEntryDtoSchema).describe('The entries that submitted their bracket, best first. An entry still in draft when the event started is left out.'),
}).describe('A bracket contest\'s leaderboard.');
export type BracketLeaderboardResponse = z.infer<typeof BracketLeaderboardResponseSchema>;

export const PickEmLeaderboardWeekDtoSchema = z.object({
  sportEventId: z.uuid(),
  name: z.string(),
  startDate: z.iso.datetime().describe('The week\'s first kickoff.'),
  status: z.enum(SportEventStatus),
  started: z.boolean().describe('Whether the week\'s first game has kicked off: until then no entry has points for it.'),
  settled: z.boolean().describe('Whether the week has settled: its points and places are frozen, and a later result correction changes nothing. A cancelled week, or a completed week no entry submitted, is settled with nothing frozen.'),
  gameCount: z.number().int().describe('The week\'s games, cancelled ones left out. None when the week was cancelled.'),
  tiebreakerTotalPoints: z.number().int().nullable().describe('The week\'s last game\'s combined score once it is played: what the week\'s tiebreakers are measured against.'),
  winnerEntryIds: z.array(z.uuid()).describe('The week\'s winners, the entries in first place once the week has settled; more than one when they are still level after the tiebreaker. Empty until it settles.'),
}).describe('One week of a pick\'em contest.');
export type PickEmLeaderboardWeekDto = z.infer<typeof PickEmLeaderboardWeekDtoSchema>;

export const PickEmLeaderboardEntryWeekDtoSchema = z.object({
  sportEventId: z.uuid(),
  submitted: z.boolean().describe('Whether the entry submitted the week. A week still in draft at its first kickoff scores nothing.'),
  points: z.number().int().nullable().describe('The entry\'s points for the week: 1 for each correct pick straight up, the pick\'s confidence value in a confidence pool. Null until the week starts, and for a week it did not submit or that was cancelled.'),
  position: z.number().int().nullable().describe('The entry\'s place in the week: by points, then, once the week\'s last game is played, by how close its tiebreaker was to that game\'s total points. Null where points is.'),
  displayPosition: z.string().nullable().describe('The place as shown, "T2" when shared.'),
  weeklyWinner: z.boolean().describe('Whether the entry won the week: first place once the week has settled.'),
}).describe('One entry\'s result for one week of a pick\'em contest.');
export type PickEmLeaderboardEntryWeekDto = z.infer<typeof PickEmLeaderboardEntryWeekDtoSchema>;

export const PickEmLeaderboardEntryDtoSchema = z.object({
  entryId: z.uuid(),
  entryName: z.string(),
  entryNumber: z.number().int(),
  squadId: z.uuid(),
  squadName: z.string(),
  position: z.number().int().nullable().describe('The entry\'s place in the season, by total points. Entries level share a place. Null until a week the entry submitted has started.'),
  displayPosition: z.string().nullable().describe('The place as shown, "T2" when shared.'),
  totalPoints: z.number().int().describe('The season total so far: the sum of the entry\'s points over the weeks that have started.'),
  weeks: z.array(PickEmLeaderboardEntryWeekDtoSchema).describe('The entry\'s result for each of the contest\'s weeks, in the contest\'s week order.'),
}).describe('One entry\'s standing in a pick\'em contest.');
export type PickEmLeaderboardEntryDto = z.infer<typeof PickEmLeaderboardEntryDtoSchema>;

export const PickEmLeaderboardResponseSchema = z.object({
  contestId: z.uuid(),
  mode: z.enum(PickEmMode),
  againstTheSpread: z.boolean().describe('Whether picks are scored against each game\'s spread.'),
  weeks: z.array(PickEmLeaderboardWeekDtoSchema).describe('The contest\'s weeks in its week order.'),
  entries: z.array(PickEmLeaderboardEntryDtoSchema).describe('The entries that submitted at least one week, best first.'),
}).describe('A pick\'em contest\'s season leaderboard: the season total, each week\'s points and places, and the weekly winners.');
export type PickEmLeaderboardResponse = z.infer<typeof PickEmLeaderboardResponseSchema>;

export const SurvivorLeaderboardWeekDtoSchema = z.object({
  sportEventId: z.uuid(),
  weekNumber: z.number().int().describe('1 for the contest\'s first week, by start date.'),
  roundNumber: z.number().int().describe('The round of the event the week is (#785): 1 for a regular-season week, which is an event of one round; each round of a playoff bracket is a week of its own.'),
  roundCount: z.number().int().describe('The event\'s number of rounds, for the round\'s name: 1 for a regular-season week.'),
  name: z.string().describe('The event\'s name; a playoff round is named by its round number and the event\'s round names.'),
  startDate: z.iso.datetime().describe('The week\'s first kickoff.'),
  status: z.enum(SportEventStatus),
  started: z.boolean().describe('Whether the week\'s first game has kicked off: an entry not submitted by then is out.'),
  aliveCount: z.number().int().describe('How many entries are still in after the week: those that survived it and those whose game is still to finish. 0 until it starts, and for a cancelled week.'),
}).describe('One week of a survivor contest: a regular-season week, or one round of a playoff bracket.');
export type SurvivorLeaderboardWeekDto = z.infer<typeof SurvivorLeaderboardWeekDtoSchema>;

export const SurvivorLeaderboardEntryWeekDtoSchema = z.object({
  sportEventId: z.uuid(),
  roundNumber: z.number().int().describe('The round of the event the week is, as on the contest\'s weeks.'),
  outcome: z.enum(SurvivorWeekOutcome).nullable().describe('SURVIVED when the picked team won or its game was cancelled, ELIMINATED after a loss, a tie or a week not submitted by its first kickoff, PENDING while the game is unplayed. Null before the week starts, for a cancelled week, and for weeks after the entry went out.'),
  team: z.string().nullable().describe('The team the entry picked, once its game has kicked off. Null before then, and with no pick.'),
}).describe('One entry\'s week of a survivor contest.');
export type SurvivorLeaderboardEntryWeekDto = z.infer<typeof SurvivorLeaderboardEntryWeekDtoSchema>;

export const SurvivorLeaderboardEntryDtoSchema = z.object({
  entryId: z.uuid(),
  entryName: z.string(),
  entryNumber: z.number().int(),
  squadId: z.uuid(),
  squadName: z.string(),
  alive: z.boolean().describe('Whether the entry is still in.'),
  eliminatedInWeek: z.number().int().nullable().describe('The week number that put the entry out; null while it is in.'),
  weeksSurvived: z.number().int().describe('The weeks the entry survived: its score.'),
  position: z.number().int().describe('The entry\'s place: entries still in first, then by weeks survived. Entries out in the same week share a place, as do entries still in at the end.'),
  displayPosition: z.string().describe('The place as shown, "T2" when shared.'),
  weeks: z.array(SurvivorLeaderboardEntryWeekDtoSchema).describe('The entry\'s result for each of the contest\'s weeks, in week order.'),
}).describe('One entry\'s standing in a survivor contest.');
export type SurvivorLeaderboardEntryDto = z.infer<typeof SurvivorLeaderboardEntryDtoSchema>;

export const SurvivorLeaderboardResponseSchema = z.object({
  contestId: z.uuid(),
  weeks: z.array(SurvivorLeaderboardWeekDtoSchema).describe('The contest\'s weeks in week order.'),
  entries: z.array(SurvivorLeaderboardEntryDtoSchema).describe('The entries that submitted at least one week, best first.'),
}).describe('A survivor contest\'s leaderboard: who is still in, and when each entry went out.');
export type SurvivorLeaderboardResponse = z.infer<typeof SurvivorLeaderboardResponseSchema>;

registerSchema('SaveGamePicksRequest', SaveGamePicksRequestSchema);
registerSchema('SurvivorLeaderboardResponse', SurvivorLeaderboardResponseSchema);
registerSchema('PickEmLeaderboardResponse', PickEmLeaderboardResponseSchema);
registerSchema('BracketLeaderboardResponse', BracketLeaderboardResponseSchema);
registerSchema('GamePicksResponse', GamePicksResponseSchema);
