/**
 * League history (#837): the contests that went final in a championship year, for the drill-through
 * under the finish matrix. Read from each contest's stored finishes, so a squad's list or a matrix
 * cell's list holds exactly as many contests as the matrix counts.
 */
import { z } from 'zod';
import { CHAMPIONSHIP_MATRIX_PLACES, ContestResultCount, SelectionType } from '@poolmaster/shared/domain';
import { ChampionshipSquadDtoSchema } from './championship.dto';
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

registerSchema('ListContestResultsQuery', ListContestResultsQuerySchema);
registerSchema('ContestResultSquadFinishDto', ContestResultSquadFinishDtoSchema);
registerSchema('ContestResultSummaryDto', ContestResultSummaryDtoSchema);
registerSchema('ContestResultListResponse', ContestResultListResponseSchema);
