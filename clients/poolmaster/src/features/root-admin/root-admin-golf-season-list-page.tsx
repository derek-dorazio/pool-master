import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { adminCreateGolfSeason, adminListGolfLeagues, adminListGolfSeasons } from '@/lib/api';
import {
  Button,
  DataGridPage,
  FormField,
  FormModal,
  Input,
  Select,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type {
  AdminListGolfLeaguesResponses,
  AdminListGolfSeasonsResponses,
} from '@/lib/api';
import { localDateTimeInputToIso } from './golf-admin-utils';

type GolfLeague = AdminListGolfLeaguesResponses[200]['leagues'][number];
type GolfSeason = AdminListGolfSeasonsResponses[200]['seasons'][number];

type SeasonRow = GolfSeason & { tourName: string; isCurrent: boolean };

const columnHelper = createColumnHelper<SeasonRow>();

const newSeasonSchema = z.object({
  sportLeagueId: z.string().min(1, 'Choose a tour'),
  name: z.string().trim().min(1, 'Season name is required'),
  year: z.coerce.number().int().min(2000, 'Enter a four-digit year'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
});

type NewSeasonValues = z.infer<typeof newSeasonSchema>;

/**
 * plans/124 §6.3 — /manage/golf/seasons "Season list". DataGridPage over
 * adminListGolfSeasons with a Tour Select filter driven by `?sportLeagueId=`
 * (arriving from Tour Home), a "New season" FormModal, and rows linking to
 * Season Home. "Current" is derived by cross-referencing each tour's
 * currentSeasonId, since the list response itself does not carry `isCurrent`.
 */
export function RootAdminGolfSeasonListPage() {
  const logger = getLogger().child({
    feature: 'root-admin-golf-season-list-page',
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const tourFilter = searchParams.get('sportLeagueId') ?? '';
  const [createOpen, setCreateOpen] = useState(false);

  const leaguesQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tours,
    queryFn: async (): Promise<GolfLeague[]> => {
      const response = await adminListGolfLeagues();
      if (!response.data?.leagues) {
        throw response.error ?? new Error('Golf tour list response is missing data.');
      }
      return response.data.leagues;
    },
    retry: false,
  });

  const seasonsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.seasons(tourFilter || undefined),
    queryFn: async (): Promise<GolfSeason[]> => {
      const response = await adminListGolfSeasons({
        query: tourFilter ? { sportLeagueId: tourFilter } : {},
      });
      if (!response.data?.seasons) {
        throw response.error ?? new Error('Golf season list response is missing data.');
      }
      return response.data.seasons;
    },
    retry: false,
  });

  const leagues = useMemo(() => leaguesQuery.data ?? [], [leaguesQuery.data]);

  const rows = useMemo<SeasonRow[]>(() => {
    const nameById = new Map(leagues.map((league) => [league.id, league.name]));
    const currentSeasonIds = new Set(
      leagues.map((league) => league.currentSeasonId).filter(Boolean),
    );
    return (seasonsQuery.data ?? []).map((season) => ({
      ...season,
      tourName: nameById.get(season.sportLeagueId) ?? season.sportLeagueId,
      isCurrent: currentSeasonIds.has(season.id),
    }));
  }, [leagues, seasonsQuery.data]);

  const form = useForm<NewSeasonValues>({
    resolver: zodResolver(newSeasonSchema),
    defaultValues: {
      sportLeagueId: tourFilter,
      name: '',
      year: new Date().getFullYear() + 1,
      startDate: '',
      endDate: '',
    },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewSeasonValues) => {
      const response = await adminCreateGolfSeason({
        body: {
          sportLeagueId: values.sportLeagueId,
          name: values.name,
          year: values.year,
          startDate: localDateTimeInputToIso(values.startDate) ?? values.startDate,
          endDate: localDateTimeInputToIso(values.endDate) ?? values.endDate,
        },
      });
      if (!response.data?.season) {
        throw response.error ?? new Error('Golf season creation response is missing data.');
      }
      return response.data.season;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.seasons(),
      QueryKeys.rootAdmin.golf.seasons(tourFilter || undefined),
      QueryKeys.rootAdmin.golf.tours,
    ],
    onSuccess: () => {
      setCreateOpen(false);
      form.reset({
        sportLeagueId: tourFilter,
        name: '',
        year: new Date().getFullYear() + 1,
        startDate: '',
        endDate: '',
      });
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.season.create.failed', err: error },
        'Golf season creation was rejected',
      );
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Season',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('tourName', { header: 'Tour' }),
      columnHelper.accessor('year', { header: 'Year' }),
      columnHelper.accessor('isCurrent', {
        header: 'Current',
        cell: ({ getValue }) =>
          getValue() ? (
            <StatusBadge tone="active">Current</StatusBadge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        enableColumnFilter: false,
      }),
      columnHelper.accessor('tournamentCount', { header: 'Tournaments' }),
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FormField className="min-w-[16rem]" label="Filter by tour">
          <Select
            data-testid="root-admin-golf-season-list-tour-filter"
            onChange={(event) => {
              const next = event.target.value;
              setSearchParams(
                (params) => {
                  if (next) {
                    params.set('sportLeagueId', next);
                  } else {
                    params.delete('sportLeagueId');
                  }
                  return params;
                },
                { replace: true },
              );
            }}
            value={tourFilter}
          >
            <option value="">All tours</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name}
              </option>
            ))}
          </Select>
        </FormField>
        <Button
          data-testid="root-admin-golf-season-list-new"
          disabled={leagues.length === 0}
          onClick={() => {
            form.reset({
              sportLeagueId: tourFilter || leagues[0]?.id || '',
              name: '',
              year: new Date().getFullYear() + 1,
              startDate: '',
              endDate: '',
            });
            setCreateOpen(true);
          }}
        >
          New season
        </Button>
      </div>

      <DataGridPage
        columns={columns}
        data={rows}
        emptyMessage={
          tourFilter
            ? 'This tour has no seasons yet.'
            : 'No golf seasons have been created yet.'
        }
        errorBody={extractErrorMessage(seasonsQuery.error, {
          fallback: 'We could not load golf seasons right now.',
        })}
        filterTestIdPrefix="root-admin-golf-season-list-filter"
        getRowId={(season) => season.id}
        getRowLink={(season) => `/manage/golf/seasons/${season.id}`}
        loadingBody="Loading golf seasons..."
        rowTestId={(season) => `root-admin-golf-season-row-${season.id}`}
        state={
          seasonsQuery.isLoading
            ? 'loading'
            : seasonsQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-golf-season-list-table"
        testId="root-admin-golf-season-list-page"
      />

      <FormModal
        canSave={form.formState.isValid}
        error={createMutation.error}
        isPending={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOpenChange={(next) => !next && setCreateOpen(false)}
        onSave={() => {
          void form.handleSubmit((values) => createMutation.mutate(values))();
        }}
        open={createOpen}
        saveLabel="Create season"
        saveTestId="root-admin-golf-season-list-new-save"
        testId="root-admin-golf-season-list-new-modal"
        title="New golf season"
      >
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          <FormField
            error={form.formState.errors.sportLeagueId?.message}
            label="Tour"
          >
            <Select
              data-testid="root-admin-golf-season-list-new-tour"
              {...form.register('sportLeagueId')}
            >
              <option value="">Select a tour</option>
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField error={form.formState.errors.name?.message} label="Season name">
              <Input
                data-testid="root-admin-golf-season-list-new-name"
                placeholder="PGA Tour 2027"
                {...form.register('name')}
              />
            </FormField>
            <FormField error={form.formState.errors.year?.message} label="Year">
              <Input
                data-testid="root-admin-golf-season-list-new-year"
                type="number"
                {...form.register('year')}
              />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              error={form.formState.errors.startDate?.message}
              label="Starts"
            >
              <Input type="date" {...form.register('startDate')} />
            </FormField>
            <FormField error={form.formState.errors.endDate?.message} label="Ends">
              <Input type="date" {...form.register('endDate')} />
            </FormField>
          </div>
        </form>
      </FormModal>
    </div>
  );
}
