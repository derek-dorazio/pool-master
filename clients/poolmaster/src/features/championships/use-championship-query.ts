import { useQuery } from '@tanstack/react-query';
import {
  getChampionship,
  getHistorySummary,
  getSquadYear,
  listChampionshipYears,
  listContestResults,
  type ChampionshipDto,
  type ChampionshipYearDto,
  type ContestResultSummaryDto,
  type HistorySummaryDto,
  type SquadYearDto,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ContestResultFilter } from './championship-view';

/** The league championship's years with a counted contest, newest first (#863). */
export function useChampionshipYearsQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.championship.years(leagueId),
    queryFn: async (): Promise<ChampionshipYearDto[]> => {
      const response = await listChampionshipYears({ path: { id: leagueId } });

      if (!response.data?.years) {
        throwApiError(response.error, 'Championship years response is missing data.');
      }

      return response.data.years;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}

/** One year of the league championship (#863): standings, medal tiles and progress. */
export function useChampionshipQuery(leagueId: string, year: number) {
  return useQuery({
    queryKey: QueryKeys.championship.byYear(leagueId, year),
    queryFn: async (): Promise<ChampionshipDto> => {
      const response = await getChampionship({ path: { id: leagueId, year } });

      if (!response.data?.championship) {
        throwApiError(response.error, 'Championship response is missing data.');
      }

      return response.data.championship;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}

/**
 * The contests that went final in a championship year (#837), newest first: every one, or one
 * squad's counted contests, or one cell of its matrix row. Asks for nothing until a year is chosen.
 */
export function useChampionshipContestsQuery(leagueId: string, year: number | null, filter: ContestResultFilter | null) {
  const squadId = filter?.squadId ?? null;
  const place = filter?.place ?? null;
  return useQuery({
    queryKey: QueryKeys.championship.contests(leagueId, year, squadId, place),
    queryFn: async (): Promise<ContestResultSummaryDto[]> => {
      if (year === null) {
        throw new Error('Championship contests asked for without a year.');
      }
      const response = await listContestResults({
        path: { id: leagueId },
        query: { year, ...(squadId === null ? {} : { squadId }), ...(place === null ? {} : { place }) },
      });

      if (!response.data?.contests) {
        throwApiError(response.error, 'Championship contests response is missing data.');
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId) && year !== null,
    retry: false,
  });
}

/** All years (#837): each year's champions and cups, and the most championships and cups won. */
export function useHistorySummaryQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.championship.summary(leagueId),
    queryFn: async (): Promise<HistorySummaryDto> => {
      const response = await getHistorySummary({ path: { id: leagueId } });

      if (!response.data?.summary) {
        throwApiError(response.error, 'History summary response is missing data.');
      }

      return response.data.summary;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}

/** One squad's year for its squad page (#872): its championship row and its cup rows. */
export function useSquadYearQuery(leagueId: string, squadId: string, year: number) {
  return useQuery({
    queryKey: QueryKeys.championship.squadYear(leagueId, squadId, year),
    queryFn: async (): Promise<SquadYearDto> => {
      const response = await getSquadYear({ path: { id: leagueId, squadId }, query: { year } });

      if (!response.data?.squadYear) {
        throwApiError(response.error, 'Squad year response is missing data.');
      }

      return response.data.squadYear;
    },
    enabled: Boolean(leagueId) && Boolean(squadId),
    retry: false,
  });
}
