/**
 * Sports league cups (#841): a league's season-long points race per sports league ("2026 PGA Tour
 * Cup"). Every finishing place in a contest earns points from the league's points table, and a
 * squad scores from its best entry. Standings are worked out from the contests' frozen places on
 * every read.
 */
import { z } from 'zod';
import {
  ContestStatus,
  CupContestCount,
  CupStatus,
  CupTrophy,
  CupWeight,
  SelectionType,
  TeamIconKey,
  type TeamIconKey as TeamIconKeyValue,
} from '@poolmaster/shared/domain';
import { registerSchema } from './schema-registry';
import { DateTimeSchema } from './common.dto';

const TeamIconKeyValues = Object.values(TeamIconKey) as [TeamIconKeyValue, ...TeamIconKeyValue[]];

const PointsSchema = z.number().int().describe('Points in tenths of a point: 725 is 72.5. Show to one decimal.');

export const ListCupsQuerySchema = z.object({
  seasonYear: z.number().int().describe('The season whose cups to list, such as 2026.'),
}).describe('Which season\'s cups to list.');
export type ListCupsQuery = z.infer<typeof ListCupsQuerySchema>;

export const CupSquadPointsQuerySchema = z.object({
  seasonYear: z.number().int().describe('The cup\'s season, such as 2026.'),
  sportLeagueId: z.uuid().describe('The cup\'s sports league.'),
}).describe('Which cup: the league has one per season and sports league.');
export type CupSquadPointsQuery = z.infer<typeof CupSquadPointsQuerySchema>;

export const CupSeasonListResponseSchema = z.object({
  seasonYears: z.array(z.number().int()).describe('Seasons with a cup to show, newest first; empty before the league has a contest.'),
}).describe('The seasons in which a league has cups.');
export type CupSeasonListResponse = z.infer<typeof CupSeasonListResponseSchema>;

export const CupStandingRowDtoSchema = z.object({
  squadId: z.uuid(),
  squadName: z.string().describe('The squad\'s current name.'),
  squadIconKey: z.enum(TeamIconKeyValues).describe('The squad\'s built-in team icon.'),
  squadIsActive: z.boolean().describe('False for an inactive squad, shown because it placed in a counted contest.'),
  position: z.number().int().min(1).describe('Place in the cup, 1 best. Squads equal on points, wins and podiums share it.'),
  displayPosition: z.string().describe('The place as shown: "T2" for a shared 2nd.'),
  points: PointsSchema,
  wins: z.number().int().describe('Counted contests the squad won, alone or tied.'),
  podiums: z.number().int().describe('Counted contests the squad finished 1st, 2nd or 3rd.'),
  contestsCounted: z.number().int().describe('Counted contests the squad placed in.'),
  movement: z.number().int().nullable().describe('Places gained (positive) or lost (negative) since before the latest counted contest went final; null until two contests have counted.'),
  pointsAfter: z.array(PointsSchema).describe('The squad\'s running total after each counted contest, in the order they went final (tenths): the race chart\'s line. Empty until a contest counts.'),
  trophy: z.enum(CupTrophy).nullable().describe('The trophy the squad took from a crowned cup: CHAMPION, RUNNER_UP or THIRD, shared on a tie. Null while the cup is open, below 3rd, and at 0 points.'),
}).describe('One squad\'s place in a cup. Every active squad has a row, at 0 points until it places; a crowned cup\'s rows are frozen at crowning.');
export type CupStandingRowDto = z.infer<typeof CupStandingRowDtoSchema>;

export const CupWinnerDtoSchema = z.object({
  squadId: z.uuid(),
  squadName: z.string(),
}).describe('A squad that won a contest; a tie for 1st lists each.');
export type CupWinnerDto = z.infer<typeof CupWinnerDtoSchema>;

export const CupContestRowDtoSchema = z.object({
  contestId: z.uuid(),
  name: z.string(),
  status: z.enum(ContestStatus).describe('The contest\'s status; drafts are never listed.'),
  selectionType: z.enum(SelectionType),
  cupWeight: z.enum(CupWeight).describe('How much it counts: NORMAL x1, BONUS x1.5, DOUBLE x2, NOT_COUNTED not at all. Once final, the weight it was settled with.'),
  count: z.enum(CupContestCount).describe('COUNTED: final with places, which earned points. NOT_COUNTED: its weight is not counted. NO_RESULT: final with nobody placed, every event cancelled. NOT_FINAL: open or live; it counts once final. AFTER_CROWNING: the cup was crowned before it went final, so it changes nothing.'),
  firstEventStartsAt: DateTimeSchema.describe('When its first event starts (instant).'),
  completedAt: DateTimeSchema.nullable().describe('When it went final (instant); null before.'),
  winners: z.array(CupWinnerDtoSchema).describe('The squads that won it; empty unless it counted.'),
}).describe('One of the league\'s contests in the cup\'s season and sports league.');
export type CupContestRowDto = z.infer<typeof CupContestRowDtoSchema>;

export const CupDtoSchema = z.object({
  id: z.uuid(),
  leagueId: z.uuid(),
  seasonYear: z.number().int(),
  sportLeagueId: z.uuid(),
  sportLeagueName: z.string().describe('The sports league, such as "PGA Tour".'),
  name: z.string().describe('The cup\'s name, built from season and sports league: "2026 PGA Tour Cup".'),
  status: z.enum(CupStatus).describe('OPEN while its standings are worked out on read; CROWNED once the commissioner has crowned it, its standings frozen.'),
  crownedAt: DateTimeSchema.nullable().describe('When it was crowned (instant); null while open.'),
  standings: z.array(CupStandingRowDtoSchema).describe('Best first; squads sharing a place in name order.'),
  contests: z.array(CupContestRowDtoSchema).describe('Every contest of the season and sports league, drafts left out, by first event start.'),
}).describe('A sports league cup in a league: one per season and sports league, made with its first contest.');
export type CupDto = z.infer<typeof CupDtoSchema>;

export const CupListResponseSchema = z.object({
  cups: z.array(CupDtoSchema).describe('The season\'s cups, oldest first.'),
}).describe('A season\'s cups.');
export type CupListResponse = z.infer<typeof CupListResponseSchema>;

export const CupResponseSchema = z.object({
  cup: CupDtoSchema,
}).describe('One cup.');
export type CupResponse = z.infer<typeof CupResponseSchema>;

export const CupSquadContestDtoSchema = z.object({
  contestId: z.uuid(),
  name: z.string(),
  cupWeight: z.enum(CupWeight),
  completedAt: DateTimeSchema.nullable().describe('When it went final (instant).'),
  place: z.number().int().min(1).nullable().describe('The squad\'s best entry\'s place, 1 best; null when it had no ranked entry.'),
  displayPlace: z.string().nullable().describe('The place as shown: "T2" for a shared 2nd; null when it had no ranked entry.'),
  rankedEntryCount: z.number().int().describe('Entries ranked in the contest.'),
  points: PointsSchema,
}).describe('One counted contest in a squad\'s cup points.');
export type CupSquadContestDto = z.infer<typeof CupSquadContestDtoSchema>;

export const CupSquadPointsDtoSchema = z.object({
  cupId: z.uuid(),
  cupName: z.string().describe('The cup\'s name, from its season and sports league: "2026 PGA Tour Cup".'),
  squadId: z.uuid(),
  squadName: z.string(),
  points: PointsSchema,
  contests: z.array(CupSquadContestDtoSchema).describe('Every counted contest, in the order they went final.'),
}).describe('One squad\'s cup points, contest by contest.');
export type CupSquadPointsDto = z.infer<typeof CupSquadPointsDtoSchema>;

export const CupSquadPointsResponseSchema = z.object({
  squadPoints: CupSquadPointsDtoSchema,
}).describe('One squad\'s cup points.');
export type CupSquadPointsResponse = z.infer<typeof CupSquadPointsResponseSchema>;

export const CupProjectedStandingDtoSchema = z.object({
  squadId: z.uuid(),
  position: z.number().int().min(1).describe('Place in the cup if the live contests ended now, 1 best; ties share it as in the standings.'),
  displayPosition: z.string().describe('The place as shown: "T2" for a shared 2nd.'),
  points: PointsSchema.describe('Points if the live contests ended now (tenths), the counted contests\' included.'),
  gained: PointsSchema.describe('Points the live contests would add (tenths).'),
  movement: z.number().int().describe('Places gained (positive) or lost (negative) against the standings as they are.'),
}).describe('One squad\'s place in a cup if its live contests ended now.');
export type CupProjectedStandingDto = z.infer<typeof CupProjectedStandingDtoSchema>;

export const CupLiveContestDtoSchema = z.object({
  contestId: z.uuid(),
  name: z.string(),
  cupWeight: z.enum(CupWeight).describe('The weight the projection scores it at: its own, until it settles.'),
}).describe('A live contest a cup projection counts.');
export type CupLiveContestDto = z.infer<typeof CupLiveContestDtoSchema>;

export const CupProjectionDtoSchema = z.object({
  cupId: z.uuid(),
  contests: z.array(CupLiveContestDtoSchema).describe('The live contests counted as if they ended now, by first event start; empty when none is live.'),
  standings: z.array(CupProjectedStandingDtoSchema).describe('Best first, one row per squad the standings show.'),
}).describe('An open cup\'s standings if every live contest it counts ended now, scored from each contest\'s leaderboard as it stands. Nothing is stored: show it greyed, as "if it ended now".');
export type CupProjectionDto = z.infer<typeof CupProjectionDtoSchema>;

export const CupProjectionResponseSchema = z.object({
  projection: CupProjectionDtoSchema,
}).describe('A cup\'s projected standings.');
export type CupProjectionResponse = z.infer<typeof CupProjectionResponseSchema>;

registerSchema('ListCupsQuery', ListCupsQuerySchema);
registerSchema('CupSquadPointsQuery', CupSquadPointsQuerySchema);
registerSchema('CupSeasonListResponse', CupSeasonListResponseSchema);
registerSchema('CupStandingRowDto', CupStandingRowDtoSchema);
registerSchema('CupWinnerDto', CupWinnerDtoSchema);
registerSchema('CupContestRowDto', CupContestRowDtoSchema);
registerSchema('CupDto', CupDtoSchema);
registerSchema('CupListResponse', CupListResponseSchema);
registerSchema('CupResponse', CupResponseSchema);
registerSchema('CupSquadContestDto', CupSquadContestDtoSchema);
registerSchema('CupSquadPointsDto', CupSquadPointsDtoSchema);
registerSchema('CupSquadPointsResponse', CupSquadPointsResponseSchema);
registerSchema('CupProjectedStandingDto', CupProjectedStandingDtoSchema);
registerSchema('CupLiveContestDto', CupLiveContestDtoSchema);
registerSchema('CupProjectionDto', CupProjectionDtoSchema);
registerSchema('CupProjectionResponse', CupProjectionResponseSchema);
