/**
 * The league championship (#863): every counted contest of every sport, in the calendar year it
 * went final (US Eastern), named by the league's cup name ("2026 Derek's Pool Cup"). Each squad's
 * finish is stored at settlement with the points it earned then.
 */
import { z } from 'zod';
import {
  ChampionshipTile,
  TeamIconKey,
  type TeamIconKey as TeamIconKeyValue,
} from '@poolmaster/shared/domain';
import { registerSchema } from './schema-registry';

const TeamIconKeyValues = Object.values(TeamIconKey) as [TeamIconKeyValue, ...TeamIconKeyValue[]];

export const ChampionshipSquadDtoSchema = z.object({
  squadId: z.uuid(),
  squadName: z.string().describe('The squad\'s current name.'),
  squadIconKey: z.enum(TeamIconKeyValues).describe('The squad\'s built-in team icon.'),
}).describe('A squad named on the championship: a leader, a champion or a tile holder.');
export type ChampionshipSquadDto = z.infer<typeof ChampionshipSquadDtoSchema>;

export const ChampionshipStandingRowDtoSchema = z.object({
  squadId: z.uuid(),
  squadName: z.string().describe('The squad\'s current name.'),
  squadIconKey: z.enum(TeamIconKeyValues).describe('The squad\'s built-in team icon.'),
  squadIsActive: z.boolean().describe('False for an inactive squad, shown because it placed in a counted contest of the year.'),
  position: z.number().int().min(1).describe('Place in the championship, 1 best. Squads equal on points, 1sts and 2nds share it.'),
  displayPosition: z.string().describe('The place as shown: "T2" for a shared 2nd.'),
  points: z.number().int().describe('Points in tenths of a point: 725 is 72.5. Show to one decimal.'),
  finishes: z.array(z.number().int()).length(10).describe('The finish matrix row: how many counted contests the squad finished 1st, 2nd ... 10th in; index 0 counts 1sts.'),
  podiums: z.number().int().describe('Counted contests finished 1st, 2nd or 3rd.'),
  topTens: z.number().int().describe('Counted contests finished in the top ten.'),
  played: z.number().int().describe('Counted contests the squad placed in.'),
  movement: z.number().int().nullable().describe('Places gained (positive) or lost (negative) since before the year\'s latest counted contest went final; null until two contests have counted, and once the year is over.'),
}).describe('One squad\'s row in a championship year. Every active squad has one, at 0 until it places.');
export type ChampionshipStandingRowDto = z.infer<typeof ChampionshipStandingRowDtoSchema>;

export const ChampionshipTileDtoSchema = z.object({
  tile: z.enum(ChampionshipTile).describe('Which count the tile leads on: 1sts, 2nds, 3rds, podiums (1st to 3rd), top-ten finishes or contests played.'),
  count: z.number().int().describe('The most any squad has; 0 while nobody has any.'),
  squads: z.array(ChampionshipSquadDtoSchema).describe('Every squad holding the most, in standings order; empty while nobody has any.'),
}).describe('One medal tile.');
export type ChampionshipTileDto = z.infer<typeof ChampionshipTileDtoSchema>;

export const ChampionshipDtoSchema = z.object({
  leagueId: z.uuid(),
  year: z.number().int().describe('The calendar year, US Eastern, its contests went final in.'),
  cupName: z.string().describe('The league\'s cup name, such as "Derek\'s Pool Cup".'),
  name: z.string().describe('The championship\'s name: the year and the cup name, "2026 Derek\'s Pool Cup".'),
  isOver: z.boolean().describe('True once the year has ended in US Eastern: the standings are final and 1st is the champion. False while the year runs: 1st is the leader.'),
  contestsCounted: z.number().int().describe('Counted contests that went final in the year.'),
  contestsToGo: z.number().int().describe('For the current year, the league\'s open and live contests that will count once final; 0 for any other year.'),
  standings: z.array(ChampionshipStandingRowDtoSchema).describe('Best first; squads sharing a place in name order.'),
  tiles: z.array(ChampionshipTileDtoSchema).describe('The medal tiles, in display order: 1sts, 2nds, 3rds, podiums, top tens, played.'),
}).describe('One year of the league championship.');
export type ChampionshipDto = z.infer<typeof ChampionshipDtoSchema>;

export const ChampionshipResponseSchema = z.object({
  championship: ChampionshipDtoSchema,
}).describe('One championship year.');
export type ChampionshipResponse = z.infer<typeof ChampionshipResponseSchema>;

export const ChampionshipYearDtoSchema = z.object({
  year: z.number().int(),
  isOver: z.boolean().describe('True once the year has ended in US Eastern.'),
  leaders: z.array(ChampionshipSquadDtoSchema).describe('The squads in 1st, several on a tie: the champions once the year is over, the leaders before.'),
}).describe('One year of the league championship, with who won or leads it.');
export type ChampionshipYearDto = z.infer<typeof ChampionshipYearDtoSchema>;

export const ChampionshipYearListResponseSchema = z.object({
  years: z.array(ChampionshipYearDtoSchema).describe('Every year with a counted contest, newest first; years with none are left out.'),
}).describe('The league championship\'s years.');
export type ChampionshipYearListResponse = z.infer<typeof ChampionshipYearListResponseSchema>;

registerSchema('ChampionshipSquadDto', ChampionshipSquadDtoSchema);
registerSchema('ChampionshipStandingRowDto', ChampionshipStandingRowDtoSchema);
registerSchema('ChampionshipTileDto', ChampionshipTileDtoSchema);
registerSchema('ChampionshipDto', ChampionshipDtoSchema);
registerSchema('ChampionshipResponse', ChampionshipResponseSchema);
registerSchema('ChampionshipYearDto', ChampionshipYearDtoSchema);
registerSchema('ChampionshipYearListResponse', ChampionshipYearListResponseSchema);
