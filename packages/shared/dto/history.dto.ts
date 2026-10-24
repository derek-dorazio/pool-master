/**
 * League history (#837): the contests that went final in a championship year, for the drill-through
 * under the finish matrix, read from each contest's stored finishes so a squad's list or a matrix
 * cell's list holds exactly as many contests as the matrix counts; the All years summary; and one
 * squad's year for its squad page (#872).
 */
import { z } from 'zod';
import { CHAMPIONSHIP_MATRIX_PLACES, ContestResultCount, CupStatus, CupTrophy, RecordType, SelectionType, SummaryTile, TrophyKind, YearReviewStatus } from '@poolmaster/shared/domain';
import { ChampionshipSquadDtoSchema, ChampionshipStandingRowDtoSchema } from './championship.dto';
import { CupStandingRowDtoSchema } from './cups.dto';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

export const ListContestResultsQuerySchema = z.object({
  year: z.number().int().min(2000).max(9999).describe('The championship year, US Eastern, the contests went final in, such as 2026.'),
  squadId: z.string().uuid().optional().describe('Only the counted contests this squad placed in: its Played count.'),
  place: z.number().int().min(1).max(CHAMPIONSHIP_MATRIX_PLACES).optional().describe('With squadId, only the counted contests the squad finished in this place: its matrix cell. Refused without squadId (400 SQUAD_ID_REQUIRED).'),
}).describe('Which year\'s contests to list, and for which squad or matrix cell.');
export type ListContestResultsQuery = z.infer<typeof ListContestResultsQuerySchema>;

export const ContestResultSquadFinishDtoSchema = z.object({
  place: z.number().int().min(1).describe('The squad\'s place from its best entry, 1 best.'),
  displayPlace: z.string().describe('The place as shown: "T2" for a shared 2nd.'),
  points: z.number().int().describe('Championship points in tenths of a point, as earned at settlement: 725 is 72.5.'),
}).describe('The filtered squad\'s finish in one contest.');
export type ContestResultSquadFinishDto = z.infer<typeof ContestResultSquadFinishDtoSchema>;

export const ContestResultSummaryDtoSchema = z.object({
  contestId: z.string().uuid(),
  name: z.string(),
  sportLeagueName: z.string().describe('The sports league its events are in, such as "PGA Tour".'),
  selectionType: z.nativeEnum(SelectionType),
  completedAt: DateTimeSchema.describe('When it went final (instant).'),
  rankedEntryCount: z.number().int().describe('Entries ranked in it; 0 when nobody placed.'),
  count: z.nativeEnum(ContestResultCount).describe('COUNTED: squads placed and earned championship points. NOT_COUNTED: its weight is not counted, so its places earn nothing. NO_RESULT: nobody placed, every event cancelled.'),
  winners: z.array(ChampionshipSquadDtoSchema).describe('The squads that finished 1st, several on a tie, in name order; empty when nobody placed.'),
  squadFinish: ContestResultSquadFinishDtoSchema.nullable().describe('With a squadId filter, that squad\'s finish; null otherwise.'),
}).describe('One contest that went final in the year, with who won it.');
export type ContestResultSummaryDto = z.infer<typeof ContestResultSummaryDtoSchema>;

export const ContestResultListResponseSchema = z.object({
  contests: z.array(ContestResultSummaryDtoSchema).describe('Newest final first. Unfiltered: every contest that went final in the year, counted or not. Filtered by squad or cell: only the counted contests the matrix counts there.'),
}).describe('A year\'s final contests.');
export type ContestResultListResponse = z.infer<typeof ContestResultListResponseSchema>;

export const HistorySummaryTileDtoSchema = z.object({
  tile: z.nativeEnum(SummaryTile).describe('MOST_CHAMPIONSHIPS: league championships won, years over only. MOST_CUPS: crowned cups won.'),
  count: z.number().int().describe('The most any squad has; 0 while nobody has any.'),
  squads: z.array(ChampionshipSquadDtoSchema).describe('Every squad holding the most, in name order; empty while nobody has any.'),
}).describe('One All years tile.');
export type HistorySummaryTileDto = z.infer<typeof HistorySummaryTileDtoSchema>;

export const HistoryCupDtoSchema = z.object({
  cupId: z.string().uuid(),
  sportLeagueId: z.string().uuid(),
  name: z.string().describe('The cup\'s name: "2026 PGA Tour Cup".'),
  status: z.nativeEnum(CupStatus),
  contestsCounted: z.number().int().describe('Its contests that counted, so the client can leave off a cup not yet on show.'),
  winners: z.array(ChampionshipSquadDtoSchema).describe('A crowned cup\'s champions; an open cup\'s leaders (1st, with points). Several on a tie, in name order.'),
}).describe('One cup of a season, with who won or leads it.');
export type HistoryCupDto = z.infer<typeof HistoryCupDtoSchema>;

export const HistoryYearDtoSchema = z.object({
  year: z.number().int(),
  isOver: z.boolean().describe('True once the year has ended in US Eastern; false for the current year, "so far".'),
  champions: z.array(ChampionshipSquadDtoSchema).describe('The league championship\'s 1st: its champions once the year is over, its leaders before. Empty when nothing counted.'),
  cups: z.array(HistoryCupDtoSchema).describe('The cups of the season with this year, by sports league name.'),
}).describe('One year of the league, with its champions.');
export type HistoryYearDto = z.infer<typeof HistoryYearDtoSchema>;

export const HistorySummaryDtoSchema = z.object({
  tiles: z.array(HistorySummaryTileDtoSchema).describe('In display order: most championships, most cups.'),
  years: z.array(HistoryYearDtoSchema).describe('Every year with a counted championship contest or a cup, newest first.'),
}).describe('The league\'s All years summary.');
export type HistorySummaryDto = z.infer<typeof HistorySummaryDtoSchema>;

export const HistorySummaryResponseSchema = z.object({
  summary: HistorySummaryDtoSchema,
}).describe('The league\'s All years summary.');
export type HistorySummaryResponse = z.infer<typeof HistorySummaryResponseSchema>;

export const GetSquadYearQuerySchema = z.object({
  year: z.number().int().min(2000).max(9999).describe('The championship year, US Eastern, such as 2026; the cups read are the season with this year.'),
}).describe('Which year of the squad to read.');
export type GetSquadYearQuery = z.infer<typeof GetSquadYearQuerySchema>;

export const SquadChampionshipDtoSchema = z.object({
  name: z.string().describe('The championship\'s name: "2026 Derek\'s Pool Cup".'),
  isOver: z.boolean().describe('True once the year has ended in US Eastern: the place is final.'),
  squadCount: z.number().int().describe('Squads in the standings, for "3rd of 12".'),
  pointsBehindLeader: z.number().int().describe('Tenths of a point behind 1st; 0 for a squad in 1st.'),
  contestsCounted: z.number().int().describe('Counted contests that went final in the year, league-wide.'),
  contestsToGo: z.number().int().describe('For the current year, the league\'s open and live contests that will count once final; 0 for any other year.'),
  standing: ChampionshipStandingRowDtoSchema.describe('The squad\'s row of the championship standings, as the Championship tab shows it.'),
}).describe('One squad\'s place in a championship year.');
export type SquadChampionshipDto = z.infer<typeof SquadChampionshipDtoSchema>;

export const SquadCupDtoSchema = z.object({
  cupId: z.string().uuid(),
  sportLeagueId: z.string().uuid(),
  name: z.string().describe('The cup\'s name: "2026 PGA Tour Cup".'),
  status: z.nativeEnum(CupStatus),
  contestsCounted: z.number().int().describe('The cup\'s contests that counted, so the client can leave off a cup not yet on show.'),
  squadCount: z.number().int().describe('Squads in the cup\'s standings.'),
  standing: CupStandingRowDtoSchema.describe('The squad\'s row of the cup\'s standings, as the Points race shows it.'),
}).describe('One squad\'s place in a cup.');
export type SquadCupDto = z.infer<typeof SquadCupDtoSchema>;

export const SquadYearDtoSchema = z.object({
  squadId: z.string().uuid(),
  year: z.number().int(),
  championship: SquadChampionshipDtoSchema.nullable().describe('Its championship row; null for an inactive squad that placed in nothing that year.'),
  cups: z.array(SquadCupDtoSchema).describe('Every cup of the season the squad has a row in, by sports league name.'),
}).describe('One squad\'s year: its championship row and its cup rows, the same rows the league pages show.');
export type SquadYearDto = z.infer<typeof SquadYearDtoSchema>;

export const SquadYearResponseSchema = z.object({
  squadYear: SquadYearDtoSchema,
}).describe('One squad\'s year.');
export type SquadYearResponse = z.infer<typeof SquadYearResponseSchema>;

export const SquadMedalsDtoSchema = z.object({
  firsts: z.number().int().describe('Counted contests the squad finished 1st in, every year.'),
  seconds: z.number().int().describe('Counted contests it finished 2nd in, every year.'),
  thirds: z.number().int().describe('Counted contests it finished 3rd in, every year.'),
}).describe('A squad\'s contest medals, all time.');
export type SquadMedalsDto = z.infer<typeof SquadMedalsDtoSchema>;

export const SquadTrophyDtoSchema = z.object({
  kind: z.nativeEnum(TrophyKind).describe('CHAMPIONSHIP for a league championship year that is over, CUP for a crowned cup.'),
  year: z.number().int(),
  trophy: z.nativeEnum(CupTrophy).describe('The place it was won for: CHAMPION, RUNNER_UP or THIRD, shared on a tie.'),
  name: z.string().describe('What it was won in: "2025 Derek\'s Pool Cup" or "2025 NFL Cup".'),
  cupId: z.string().uuid().nullable().describe('The cup, for a cup trophy; null for a championship.'),
  sportLeagueId: z.string().uuid().nullable().describe('The cup\'s sports league, for a cup trophy; null for a championship.'),
}).describe('One trophy on a squad\'s shelf.');
export type SquadTrophyDto = z.infer<typeof SquadTrophyDtoSchema>;

export const SquadHistoryDtoSchema = z.object({
  squadId: z.string().uuid(),
  medals: SquadMedalsDtoSchema,
  trophies: z.array(SquadTrophyDtoSchema).describe('Newest year first; within a year the championship first, then cups by sports league name.'),
  years: z.array(SquadYearDtoSchema).describe('The squad\'s year for every year the league has a championship or a cup season in, newest first.'),
}).describe('A squad\'s whole history in the league.');
export type SquadHistoryDto = z.infer<typeof SquadHistoryDtoSchema>;

export const SquadHistoryResponseSchema = z.object({
  squadHistory: SquadHistoryDtoSchema,
}).describe('A squad\'s whole history in the league.');
export type SquadHistoryResponse = z.infer<typeof SquadHistoryResponseSchema>;

export const YearReviewDtoSchema = z.object({
  year: z.number().int().describe('Last year, US Eastern: the only year whose review can be sent.'),
  status: z.nativeEnum(YearReviewStatus).describe('NOTHING_TO_SEND: no championship contest counted that year. READY: the commissioner can send it. SENT: it was sent.'),
  sentAt: DateTimeSchema.nullable().describe('When it was sent; null until then.'),
  sentByName: z.string().nullable().describe('Who sent it; null until then, or once their account is gone.'),
}).describe('Where the league\'s year in review for last year stands.');
export type YearReviewDto = z.infer<typeof YearReviewDtoSchema>;

export const YearReviewResponseSchema = z.object({
  yearReview: YearReviewDtoSchema,
}).describe('Where the league\'s year in review for last year stands.');
export type YearReviewResponse = z.infer<typeof YearReviewResponseSchema>;

export const RecordHolderDtoSchema = z.object({
  squad: ChampionshipSquadDtoSchema,
  year: z.number().int().nullable().describe('The year it was set in, for MOST_WINS_IN_A_YEAR, BIGGEST_FIELD_WON and the year a run ended (BACK_TO_BACK_CHAMPIONS, LONGEST_PODIUM_RUN); null for an all-time count.'),
  contestId: z.string().uuid().nullable().describe('The contest won, for BIGGEST_FIELD_WON; null otherwise.'),
  contestName: z.string().nullable().describe('That contest\'s name; null otherwise.'),
}).describe('One holder of a record value.');
export type RecordHolderDto = z.infer<typeof RecordHolderDtoSchema>;

export const RecordStandDtoSchema = z.object({
  value: z.number().int().describe('Championships, years in a row, wins, contests in a row or ranked entries, by the record\'s type.'),
  holders: z.array(RecordHolderDtoSchema).describe('Every holder of the value, in squad name order, then newest year first.'),
}).describe('One value of a record and who holds it.');
export type RecordStandDto = z.infer<typeof RecordStandDtoSchema>;

export const RecordDtoSchema = z.object({
  type: z.nativeEnum(RecordType).describe('MOST_CHAMPIONSHIPS (years over only), BACK_TO_BACK_CHAMPIONS (two or more in consecutive years), MOST_WINS_IN_A_YEAR, MOST_WINS_ALL_TIME, LONGEST_PODIUM_RUN (contests in a row in 1st to 3rd, of those the squad placed in, in settlement order) or BIGGEST_FIELD_WON (the win with the most ranked entries); then the Hall of Lame, left out when the league hides it: MOST_RUNNER_UPS (2nd places), MOST_FOURTHS (4th places), MOST_LAST_PLACES (the worst place among the squads, in contests of three or more squads) or LONGEST_DROUGHT (contests in a row placed in without a win, past or still running).'),
  best: RecordStandDtoSchema,
  nextBest: RecordStandDtoSchema.nullable().describe('The next value down and its holders; null when nobody else has one.'),
}).describe('One record of the league\'s record book.');
export type RecordDto = z.infer<typeof RecordDtoSchema>;

export const RecordListResponseSchema = z.object({
  records: z.array(RecordDtoSchema).describe('Every record somebody holds, in RecordType order; a record nobody holds yet is left out.'),
}).describe('The league\'s record book.');
export type RecordListResponse = z.infer<typeof RecordListResponseSchema>;

export const PerpetualTrophyPlateDtoSchema = z.object({
  year: z.number().int().describe('The year of the event the contest was on: the 2026 Masters.'),
  contestId: z.string().uuid(),
  winners: z.array(ChampionshipSquadDtoSchema).describe('The contest\'s 1st place squads, every one on a tie, in name order; empty when the contest went final with nobody placed.'),
}).describe('One plate of a perpetual trophy: a year\'s contest and its winners.');
export type PerpetualTrophyPlateDto = z.infer<typeof PerpetualTrophyPlateDtoSchema>;

export const PerpetualTrophyDtoSchema = z.object({
  eventSeriesId: z.string().uuid(),
  seriesName: z.string().describe('The event series the contest is run on every year, such as "Masters Tournament".'),
  sportLeagueName: z.string(),
  selectionType: z.nativeEnum(SelectionType).describe('How the contest is picked: a series run as two ways of picking is two trophies.'),
  plates: z.array(PerpetualTrophyPlateDtoSchema).describe('Newest year first; a year the league did not run it has no plate.'),
}).describe('A perpetual trophy: a contest of one event the league has run in two or more years.');
export type PerpetualTrophyDto = z.infer<typeof PerpetualTrophyDtoSchema>;

export const PerpetualTrophyListResponseSchema = z.object({
  trophies: z.array(PerpetualTrophyDtoSchema).describe('In sports league, series and selection type order.'),
}).describe('The league\'s perpetual trophies.');
export type PerpetualTrophyListResponse = z.infer<typeof PerpetualTrophyListResponseSchema>;

registerSchema('ListContestResultsQuery', ListContestResultsQuerySchema);
registerSchema('ContestResultSquadFinishDto', ContestResultSquadFinishDtoSchema);
registerSchema('ContestResultSummaryDto', ContestResultSummaryDtoSchema);
registerSchema('ContestResultListResponse', ContestResultListResponseSchema);
registerSchema('HistorySummaryTileDto', HistorySummaryTileDtoSchema);
registerSchema('HistoryCupDto', HistoryCupDtoSchema);
registerSchema('HistoryYearDto', HistoryYearDtoSchema);
registerSchema('HistorySummaryDto', HistorySummaryDtoSchema);
registerSchema('HistorySummaryResponse', HistorySummaryResponseSchema);
registerSchema('GetSquadYearQuery', GetSquadYearQuerySchema);
registerSchema('SquadChampionshipDto', SquadChampionshipDtoSchema);
registerSchema('SquadCupDto', SquadCupDtoSchema);
registerSchema('SquadYearDto', SquadYearDtoSchema);
registerSchema('SquadYearResponse', SquadYearResponseSchema);
registerSchema('SquadMedalsDto', SquadMedalsDtoSchema);
registerSchema('SquadTrophyDto', SquadTrophyDtoSchema);
registerSchema('SquadHistoryDto', SquadHistoryDtoSchema);
registerSchema('SquadHistoryResponse', SquadHistoryResponseSchema);
registerSchema('YearReviewDto', YearReviewDtoSchema);
registerSchema('YearReviewResponse', YearReviewResponseSchema);
registerSchema('RecordHolderDto', RecordHolderDtoSchema);
registerSchema('RecordStandDto', RecordStandDtoSchema);
registerSchema('RecordDto', RecordDtoSchema);
registerSchema('RecordListResponse', RecordListResponseSchema);
registerSchema('PerpetualTrophyPlateDto', PerpetualTrophyPlateDtoSchema);
registerSchema('PerpetualTrophyDto', PerpetualTrophyDtoSchema);
registerSchema('PerpetualTrophyListResponse', PerpetualTrophyListResponseSchema);
