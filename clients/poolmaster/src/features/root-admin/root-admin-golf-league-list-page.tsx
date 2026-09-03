import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { adminCreateGolfLeague, adminListGolfLeagues } from '@/lib/api';
import {
  Button,
  DataGridPage,
  FormField,
  FormModal,
  Input,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListGolfLeaguesResponses } from '@/lib/api';
import { useManageBreadcrumbOverride } from './root-admin-manage-layout';

type GolfLeague = AdminListGolfLeaguesResponses[200]['leagues'][number];

const columnHelper = createColumnHelper<GolfLeague>();

const newTourSchema = z.object({
  name: z.string().trim().min(1, 'Tour name is required'),
  matchKeyword: z.string().trim().optional(),
});

type NewTourValues = z.infer<typeof newTourSchema>;

/**
 * plans/124 §6.3 — /manage/golf/leagues "Tours list". Read-only DataGrid over
 * adminListGolfLeagues plus a "New tour" FormModal; rows link to Tour Home,
 * following the app-wide list -> Home pattern.
 */
export function RootAdminGolfLeagueListPage() {
  useManageBreadcrumbOverride('leagues', 'Tours');

  const logger = getLogger().child({
    feature: 'root-admin-golf-league-list-page',
  });
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

  const form = useForm<NewTourValues>({
    resolver: zodResolver(newTourSchema),
    defaultValues: { name: '', matchKeyword: '' },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewTourValues) => {
      const response = await adminCreateGolfLeague({
        body: {
          name: values.name,
          ...(values.matchKeyword?.trim()
            ? { matchKeyword: values.matchKeyword.trim() }
            : {}),
        },
      });
      if (!response.data?.league) {
        throw response.error ?? new Error('Golf tour creation response is missing data.');
      }
      return response.data.league;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tours],
    onSuccess: () => {
      setCreateOpen(false);
      form.reset({ name: '', matchKeyword: '' });
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.create.failed', err: error },
        'Golf tour creation was rejected',
      );
    },
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Tour',
        cell: ({ getValue }) => (
          <span className="font-medium text-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('matchKeyword', {
        header: 'Match keyword',
        cell: ({ getValue }) => getValue() || '—',
      }),
      columnHelper.accessor('rosterSize', {
        header: 'Roster size',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('seasonCount', {
        header: 'Seasons',
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor('isActive', {
        header: 'Active',
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() ? 'active' : 'inactive'}>
            {getValue() ? 'Active' : 'Inactive'}
          </StatusBadge>
        ),
      }),
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          data-testid="root-admin-golf-league-list-new"
          onClick={() => {
            form.reset({ name: '', matchKeyword: '' });
            setCreateOpen(true);
          }}
        >
          New tour
        </Button>
      </div>

      <DataGridPage
        columns={columns}
        data={leaguesQuery.data ?? []}
        emptyMessage="No golf tours have been created yet."
        errorBody={extractErrorMessage(leaguesQuery.error, {
          fallback: 'We could not load golf tours right now.',
        })}
        filterTestIdPrefix="root-admin-golf-league-list-filter"
        getRowId={(league) => league.id}
        getRowLink={(league) => `/manage/golf/leagues/${league.id}`}
        loadingBody="Loading golf tours..."
        rowTestId={(league) => `root-admin-golf-league-row-${league.id}`}
        state={
          leaguesQuery.isLoading
            ? 'loading'
            : leaguesQuery.isError
              ? 'error'
              : 'ready'
        }
        tableTestId="root-admin-golf-league-list-table"
        testId="root-admin-golf-league-list-page"
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
        saveLabel="Create tour"
        saveTestId="root-admin-golf-league-list-new-save"
        testId="root-admin-golf-league-list-new-modal"
        title="New golf tour"
      >
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          <FormField error={form.formState.errors.name?.message} label="Tour name">
            <Input
              data-testid="root-admin-golf-league-list-new-name"
              placeholder="PGA Tour"
              {...form.register('name')}
            />
          </FormField>
          <FormField
            helperText="Optional. A plain catalog-browse filter keyword, e.g. “PGA”."
            label="Match keyword"
          >
            <Input
              data-testid="root-admin-golf-league-list-new-keyword"
              placeholder="PGA"
              {...form.register('matchKeyword')}
            />
          </FormField>
        </form>
      </FormModal>
    </div>
  );
}
