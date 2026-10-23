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

export const CupStandingRowDtoSchema = z.object({
  squadId: z.string().uuid(),
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
}).describe('One squad\'s place in a cup. Every active squad has a row, at 0 points until it places.');
export type CupStandingRowDto = z.infer<typeof CupStandingRowDtoSchema>;

export const CupWinnerDtoSchema = z.object({
  squadId: z.string().uuid(),
  squadName: z.string(),
}).describe('A squad that won a contest; a tie for 1st lists each.');
export type CupWinnerDto = z.infer<typeof CupWinnerDtoSchema>;

export const CupContestRowDtoSchema = z.object({
  contestId: z.string().uuid(),
  name: z.string(),
  status: z.nativeEnum(ContestStatus).describe('The contest\'s status; drafts are never listed.'),
  selectionType: z.nativeEnum(SelectionType),
  cupWeight: z.nativeEnum(CupWeight).describe('How much it counts: NORMAL x1, BONUS x1.5, DOUBLE x2, NOT_COUNTED not at all.'),
  count: z.nativeEnum(CupContestCount).describe('COUNTED: final with places, which earned points. NOT_COUNTED: its weight is not counted. NO_RESULT: final with nobody placed, every event cancelled. NOT_FINAL: open or live; it counts once final.'),
  firstEventStartsAt: DateTimeSchema.describe('When its first event starts (instant).'),
  completedAt: DateTimeSchema.nullable().describe('When it went final (instant); null before.'),
  winners: z.array(CupWinnerDtoSchema).describe('The squads that won it; empty unless it counted.'),
}).describe('One of the league\'s contests in the cup\'s season and sports league.');
export type CupContestRowDto = z.infer<typeof CupContestRowDtoSchema>;

export const CupDtoSchema = z.object({
  id: z.string().uuid(),
  leagueId: z.string().uuid(),
  seasonYear: z.number().int(),
  sportLeagueId: z.string().uuid(),
  sportLeagueName: z.string().describe('The sports league, such as "PGA Tour".'),
  name: z.string().describe('The cup\'s name, built from season and sports league: "2026 PGA Tour Cup".'),
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
  contestId: z.string().uuid(),
  name: z.string(),
  cupWeight: z.nativeEnum(CupWeight),
  completedAt: DateTimeSchema.nullable().describe('When it went final (instant).'),
  place: z.number().int().min(1).nullable().describe('The squad\'s best entry\'s place, 1 best; null when it had no ranked entry.'),
  displayPlace: z.string().nullable().describe('The place as shown: "T2" for a shared 2nd; null when it had no ranked entry.'),
  rankedEntryCount: z.number().int().describe('Entries ranked in the contest.'),
  points: PointsSchema,
}).describe('One counted contest in a squad\'s cup points.');
export type CupSquadContestDto = z.infer<typeof CupSquadContestDtoSchema>;

export const CupSquadPointsDtoSchema = z.object({
  cupId: z.string().uuid(),
  squadId: z.string().uuid(),
  squadName: z.string(),
  points: PointsSchema,
  contests: z.array(CupSquadContestDtoSchema).describe('Every counted contest, in the order they went final.'),
}).describe('One squad\'s cup points, contest by contest.');
export type CupSquadPointsDto = z.infer<typeof CupSquadPointsDtoSchema>;

export const CupSquadPointsResponseSchema = z.object({
  squadPoints: CupSquadPointsDtoSchema,
}).describe('One squad\'s cup points.');
export type CupSquadPointsResponse = z.infer<typeof CupSquadPointsResponseSchema>;

registerSchema('ListCupsQuery', ListCupsQuerySchema);
registerSchema('CupStandingRowDto', CupStandingRowDtoSchema);
registerSchema('CupWinnerDto', CupWinnerDtoSchema);
registerSchema('CupContestRowDto', CupContestRowDtoSchema);
registerSchema('CupDto', CupDtoSchema);
registerSchema('CupListResponse', CupListResponseSchema);
registerSchema('CupResponse', CupResponseSchema);
registerSchema('CupSquadContestDto', CupSquadContestDtoSchema);
registerSchema('CupSquadPointsDto', CupSquadPointsDtoSchema);
registerSchema('CupSquadPointsResponse', CupSquadPointsResponseSchema);
