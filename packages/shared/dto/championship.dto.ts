/**
 * The league championship (#863): every counted contest of every sport, in its championship year
 * (its Season's year, #2021), named by the league's cup name ("2026 Derek's Pool Cup"). Each squad's
 * finish is stored at settlement with the points it earned then.
 */
import { z } from 'zod';
import {
  ChampionshipTile,
  SlotKind,
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
  year: z.number().int().describe('The championship year its contests count in: their Seasons\' year, however late they went final (#2021).'),
  cupName: z.string().describe('The league\'s cup name, such as "Derek\'s Pool Cup".'),
  name: z.string().describe('The championship\'s name: the year and the cup name, "2026 Derek\'s Pool Cup".'),
  isOver: z.boolean().describe('True once the league\'s year is closed (#2021): every contest in it final and every Season slot of it played. The standings are then final and 1st is the champion. False while it is open: 1st is the leader.'),
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
  isOver: z.boolean().describe('True once the league\'s year is closed (#2021).'),
  leaders: z.array(ChampionshipSquadDtoSchema).describe('The squads in 1st, several on a tie: the champions once the year is over, the leaders before.'),
}).describe('One year of the league championship, with who won or leads it.');
export type ChampionshipYearDto = z.infer<typeof ChampionshipYearDtoSchema>;

export const ChampionshipYearListResponseSchema = z.object({
  years: z.array(ChampionshipYearDtoSchema).describe('Every year with a counted contest, newest first; years with none are left out.'),
}).describe('The league championship\'s years.');
export type ChampionshipYearListResponse = z.infer<typeof ChampionshipYearListResponseSchema>;

const ChampionshipClosingSlotDtoSchema = z.object({
  sportLeagueId: z.uuid(),
  sportLeagueName: z.string().describe('What screens call the sport league, such as "NFL".'),
  key: z.string().describe('The slot definition\'s code in its league, such as FINAL; an identifier nothing parses.'),
  name: z.string().nullable().describe('The league\'s proper name for the slot, such as "Super Bowl", or a test slot\'s label; null: screens use the word for its kind.'),
  slotKind: z.enum(SlotKind).describe('What kind of slot it is, for the word a screen shows when it has no name.'),
  weekNumber: z.number().int().nullable().describe('For a WEEK slot, its week; null otherwise.'),
  startsAt: z.iso.datetime().nullable().describe('The earliest start of its games; null until the sync has placed one.'),
  endsAt: z.iso.datetime().nullable().describe('The latest end of its games; null until the sync has placed one.'),
}).describe('A sport league\'s last Season slot of the year still to finish: the year closes after it, once its contests are final.');

const ChampionshipCalendarContestDtoSchema = z.object({
  contestId: z.uuid(),
  name: z.string().describe('The contest\'s name.'),
}).describe('A contest of the year not yet final.');

const ChampionshipCalendarYearDtoSchema = z.object({
  championshipYear: z.number().int().describe('The championship year, such as 2026.'),
  isClosed: z.boolean().describe('True once the year is closed for good (#2021): every contest in it final and every Season slot of it finished. A closed year never reopens.'),
  closesAfter: z.array(ChampionshipClosingSlotDtoSchema).describe('What holds an open year open: each sport league\'s last slot of the year still to finish, earliest first and an undated one last. Empty once closed, and when only contests hold it.'),
  unfinishedContests: z.array(ChampionshipCalendarContestDtoSchema).describe('The year\'s counted contests not yet final, oldest first; empty once closed.'),
}).describe('One championship year of the league, open or closed.');

const ChampionshipCalendarResponseSchema = z.object({
  currentYear: z.number().int().nullable().describe('The year the league is in now, which Championships opens on: the earliest open year with a live contest, else its earliest open year, else the earliest current Season year of an active sport league that it has not closed. Never the calendar year. Null only when there is none.'),
  years: z.array(ChampionshipCalendarYearDtoSchema).describe('Every year the league has a counted contest in, every closed year and the current year, newest first.'),
}).describe('The league\'s championship years, open and closed, and the one it is in now (#2021).');
export type ChampionshipCalendarResponse = z.infer<typeof ChampionshipCalendarResponseSchema>;

registerSchema('ChampionshipSquadDto', ChampionshipSquadDtoSchema);
registerSchema('ChampionshipStandingRowDto', ChampionshipStandingRowDtoSchema);
registerSchema('ChampionshipTileDto', ChampionshipTileDtoSchema);
registerSchema('ChampionshipDto', ChampionshipDtoSchema);
registerSchema('ChampionshipResponse', ChampionshipResponseSchema);
registerSchema('ChampionshipYearDto', ChampionshipYearDtoSchema);
registerSchema('ChampionshipYearListResponse', ChampionshipYearListResponseSchema);
registerSchema('ChampionshipClosingSlotDto', ChampionshipClosingSlotDtoSchema);
registerSchema('ChampionshipCalendarContestDto', ChampionshipCalendarContestDtoSchema);
registerSchema('ChampionshipCalendarYearDto', ChampionshipCalendarYearDtoSchema);
registerSchema('ChampionshipCalendarResponse', ChampionshipCalendarResponseSchema);
