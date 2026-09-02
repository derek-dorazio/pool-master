import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  adminGetGolfSeason,
  adminListGolfLeagues,
  adminListGolfTournaments,
  adminSetCurrentGolfSeason,
} from '@/lib/api';
import {
  AsyncPage,
  Button,
  ConfirmationModal,
  DefinitionList,
  LinkButton,
  StatusBadge,
  Tile,
  formatDateDisplay,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type {
  AdminGetGolfSeasonResponses,
  AdminListGolfTournamentsResponses,
} from '@/lib/api';
import { useManageBreadcrumbOverride } from './root-admin-manage-layout';
import { GolfSeasonEditModal } from './golf-season-edit-modal';
import { GolfSeasonTournamentCalendar } from './golf-season-tournament-calendar';

type GolfSeason = AdminGetGolfSeasonResponses[200]['season'];
type GolfTournament =
  AdminListGolfTournamentsResponses[200]['tournaments'][number];

/**
 * plans/124 §6.3 — /manage/golf/seasons/:seasonId "Season Home": the
 * tournament-calendar view for one year of a tour. Header carries the
 * set-current action / current badge, a "New tournament" entry into creation
 * scoped to this season, and an inline edit modal. "Clone to next year" (§4.2a)
 * lands in pool-master-pcd.
 */
export function RootAdminGolfSeasonHomePage() {
  const { seasonId = '' } = useParams<{ seasonId: string }>();
  const logger = getLogger().child({
    feature: 'root-admin-golf-season-home-page',
  });
  const [setCurrentOpen, setSetCurrentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const seasonQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.season(seasonId || null),
    queryFn: async (): Promise<GolfSeason> => {
      const response = await adminGetGolfSeason({ path: { seasonId } });
      if (!response.data?.season) {
        throw response.error ?? new Error('Golf season response is missing data.');
      }
      return response.data.season;
    },
    enabled: seasonId !== '',
    retry: false,
  });

  const season = seasonQuery.data;

  const leaguesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tours,
    queryFn: async () => {
      const response = await adminListGolfLeagues();
      if (!response.data?.leagues) {
        throw response.error ?? new Error('Golf tour list response is missing data.');
      }
      return response.data.leagues;
    },
    retry: false,
  });

  const tournamentsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tournaments,
    queryFn: async (): Promise<GolfTournament[]> => {
      const response = await adminListGolfTournaments();
      if (!response.data?.tournaments) {
        throw response.error ?? new Error('Golf tournament list response is missing data.');
      }
      return response.data.tournaments;
    },
    retry: false,
  });

  useManageBreadcrumbOverride(seasonId || undefined, season?.name);

  const tourName = useMemo(() => {
    if (!season) return '';
    if (leaguesQuery.isError) return 'Tour unavailable';
    return (
      leaguesQuery.data?.find((league) => league.id === season.sportLeagueId)
        ?.name ?? season.sportLeagueId
    );
  }, [leaguesQuery.data, leaguesQuery.isError, season]);

  const seasonTournaments = useMemo(
    () =>
      (tournamentsQuery.data ?? [])
        .filter((tournament) => tournament.seasonId === seasonId)
        .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate)),
    [seasonId, tournamentsQuery.data],
  );

  const setCurrentMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await adminSetCurrentGolfSeason({ path: { seasonId } });
      if (!response.data?.currentSeasonId) {
        throw response.error ?? new Error('Set-current response is missing data.');
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.season(seasonId || null),
      QueryKeys.rootAdmin.golf.seasons(),
      QueryKeys.rootAdmin.golf.tours,
    ],
    onSuccess: () => setSetCurrentOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'golf.season.setCurrent.failed', err: error },
        'Set-current golf season was rejected',
      );
    },
  });

  const pageState = seasonQuery.isLoading
    ? 'loading'
    : seasonQuery.isError
      ? 'error'
      : seasonId === '' || !season
        ? 'empty'
        : 'ready';

  return (
    <AsyncPage
      emptyBody="This golf season does not exist or has been removed."
      emptyTitle="Season not found"
      errorBody={extractErrorMessage(seasonQuery.error, {
        fallback: 'We could not load this golf season right now.',
      })}
      loadingBody="Loading golf season..."
      state={pageState}
      testId="root-admin-golf-season-home-page"
    >
      {season ? (
        <div className="space-y-6">
          <Tile>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{season.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{tourName}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {season.isCurrent ? (
                  <StatusBadge tone="active">Current season</StatusBadge>
                ) : (
                  <Button
                    data-testid="root-admin-golf-season-home-set-current"
                    onClick={() => setSetCurrentOpen(true)}
                    size="sm"
                    variant="secondary"
                  >
                    Set as current season
                  </Button>
                )}
                <Button
                  data-testid="root-admin-golf-season-home-edit"
                  onClick={() => setEditOpen(true)}
                  size="sm"
                  variant="secondary"
                >
                  Edit season
                </Button>
                <LinkButton
                  data-testid="root-admin-golf-season-home-new-tournament"
                  size="sm"
                  to={`/manage/golf/tournaments/new?seasonId=${season.id}`}
                >
                  New tournament
                </LinkButton>
              </div>
            </div>

            <DefinitionList
              className="mt-4"
              items={[
                { id: 'year', label: 'Year', value: season.year },
                {
                  id: 'window',
                  label: 'Season window',
                  value: `${formatDateDisplay(season.startDate)} – ${formatDateDisplay(season.endDate)}`,
                },
                {
                  id: 'tournaments',
                  label: 'Tournaments',
                  value: season.tournamentCount,
                },
              ]}
            />
          </Tile>

          <GolfSeasonTournamentCalendar
            isError={tournamentsQuery.isError}
            seasonName={season.name}
            tournaments={seasonTournaments}
          />

          <ConfirmationModal
            confirmLabel="Set as current"
            confirmTestId="root-admin-golf-season-home-set-current-confirm"
            description={`“${season.name}” becomes ${tourName}’s current season. The tour’s previous current season is cleared in the same step.`}
            errorMessage={
              setCurrentMutation.isError
                ? extractErrorMessage(setCurrentMutation.error, {
                    fallback: 'We could not set this season as current.',
                  })
                : undefined
            }
            isPending={setCurrentMutation.isPending}
            onCancel={() => setSetCurrentOpen(false)}
            onConfirm={() => setCurrentMutation.mutate()}
            onOpenChange={(next) => !next && setSetCurrentOpen(false)}
            open={setCurrentOpen}
            testId="root-admin-golf-season-home-set-current-modal"
            title="Set current season"
          />

          {editOpen ? (
            <GolfSeasonEditModal
              onClose={() => setEditOpen(false)}
              season={season}
              seasonId={seasonId}
            />
          ) : null}
        </div>
      ) : null}
    </AsyncPage>
  );
}
