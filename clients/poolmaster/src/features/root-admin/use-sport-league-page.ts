import { useQuery } from '@tanstack/react-query';
import {
  listContestConfigTemplates,
  listSportLeagueEventOverviews,
  listSportLeagueParticipantOverviews,
  listSportLeagueSyncs,
  type ContestConfigTemplateDto,
  type SportLeagueEventOverviewDto,
  type SportLeagueParticipantOverviewDto,
  type SportLeagueSyncDto,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** The League page's Syncs card (#1866): one row per sync kind, in kind order. */
export function useSportLeagueSyncsQuery(sportLeagueId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueSyncs(sportLeagueId),
    queryFn: async (): Promise<SportLeagueSyncDto[]> => {
      const response = await listSportLeagueSyncs({ path: { sportLeagueId } });
      if (!response.data?.syncs) throwApiError(response.error, 'Sport league syncs response is missing data.');
      return response.data.syncs;
    },
    retry: false,
  });
}

/** The League page's Events grid (#1866): every event of the league, every year, by start. */
export function useSportLeagueEventOverviewsQuery(sportLeagueId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueEventOverviews(sportLeagueId),
    queryFn: async (): Promise<SportLeagueEventOverviewDto[]> => {
      const response = await listSportLeagueEventOverviews({ path: { sportLeagueId } });
      if (!response.data?.events) throwApiError(response.error, 'Sport league events response is missing data.');
      return response.data.events;
    },
    retry: false,
  });
}

/** The League page's Participants grid (#1866): every participant of the league, by name. */
export function useSportLeagueParticipantOverviewsQuery(sportLeagueId: string) {
  return useQuery({
    queryKey: QueryKeys.rootAdmin.manageSport.leagueParticipantOverviews(sportLeagueId),
    queryFn: async (): Promise<SportLeagueParticipantOverviewDto[]> => {
      const response = await listSportLeagueParticipantOverviews({ path: { sportLeagueId } });
      if (!response.data?.participants) throwApiError(response.error, 'Sport league participants response is missing data.');
      return response.data.participants;
    },
    retry: false,
  });
}

/** The League page's Contest templates grid (#1866): the league's own templates, on or off. */
export function useSportLeagueContestTemplatesQuery(sportLeagueId: string) {
  return useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({ sportLeagueId }),
    queryFn: async (): Promise<ContestConfigTemplateDto[]> => {
      const response = await listContestConfigTemplates({ query: { sportLeagueId } });
      if (!response.data?.templates) throwApiError(response.error, 'Contest template response is missing data.');
      return [...response.data.templates].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
    },
    retry: false,
  });
}
