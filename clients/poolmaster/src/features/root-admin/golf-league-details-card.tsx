import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { adminUpdateGolfLeague } from '@/lib/api';
import {
  Button,
  DefinitionList,
  FormField,
  FormModal,
  Input,
  LinkButton,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListGolfLeaguesResponses, AdminUpdateGolfLeagueData } from '@/lib/api';

type GolfLeague = AdminListGolfLeaguesResponses[200]['leagues'][number];

const editSchema = z.object({
  name: z.string().trim().min(1, 'Tour name is required'),
  matchKeyword: z.string().trim().optional(),
});

type EditValues = z.infer<typeof editSchema>;

async function updateLeague(
  leagueId: string,
  body: AdminUpdateGolfLeagueData['body'],
) {
  const response = await adminUpdateGolfLeague({ path: { leagueId }, body });
  if (!response.data?.league) {
    throw response.error ?? new Error('Golf tour update response is missing data.');
  }
  return response.data.league;
}

/**
 * plans/124 §6.3 Tour Home header — the tour's identity, an inline name /
 * match-keyword edit modal, the active toggle, and the count link into this
 * tour's Season list.
 */
export function GolfLeagueDetailsCard({ league }: { league: GolfLeague }) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-league-home-page',
  });
  const [editOpen, setEditOpen] = useState(false);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: league.name, matchKeyword: league.matchKeyword ?? undefined },
    mode: 'onChange',
  });

  const editMutation = useInvalidatingMutation({
    mutationFn: (values: EditValues) =>
      updateLeague(league.id, {
        name: values.name,
        matchKeyword: values.matchKeyword?.trim() ?? '',
      }),
    invalidates: [QueryKeys.rootAdmin.golf.tours],
    onSuccess: () => setEditOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.update.failed', err: error },
        'Golf tour update was rejected',
      );
    },
  });

  const toggleActiveMutation = useInvalidatingMutation({
    mutationFn: () => updateLeague(league.id, { isActive: !league.isActive }),
    invalidates: [QueryKeys.rootAdmin.golf.tours],
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.toggleActive.failed', err: error },
        'Golf tour active toggle was rejected',
      );
    },
  });

  const submit = form.handleSubmit((values) => editMutation.mutate(values));

  return (
    <Tile>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{league.name}</h2>
          <div className="mt-2">
            <StatusBadge tone={league.isActive ? 'active' : 'inactive'}>
              {league.isActive ? 'Active' : 'Inactive'}
            </StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="root-admin-golf-league-home-edit"
            onClick={() => {
              form.reset({ name: league.name, matchKeyword: league.matchKeyword ?? undefined });
              setEditOpen(true);
            }}
            size="sm"
            variant="secondary"
          >
            Edit tour
          </Button>
          <Button
            data-testid="root-admin-golf-league-home-toggle-active"
            isLoading={toggleActiveMutation.isPending}
            onClick={() => toggleActiveMutation.mutate()}
            size="sm"
            variant={league.isActive ? 'danger' : 'secondary'}
          >
            {league.isActive ? 'Deactivate tour' : 'Activate tour'}
          </Button>
        </div>
      </div>

      <DefinitionList
        className="mt-4"
        items={[
          {
            id: 'keyword',
            label: 'Match keyword',
            value: league.matchKeyword || 'Not set',
          },
          { id: 'roster', label: 'Roster size', value: league.rosterSize },
          {
            id: 'seasons',
            label: 'Seasons',
            value: (
              <LinkButton
                data-testid="root-admin-golf-league-home-seasons-link"
                size="sm"
                to={`/manage/golf/seasons?sportLeagueId=${league.id}`}
                variant="secondary"
              >
                View {league.seasonCount} season{league.seasonCount === 1 ? '' : 's'}
              </LinkButton>
            ),
          },
        ]}
      />

      {toggleActiveMutation.isError ? (
        <p className="mt-3 text-sm font-medium text-destructive">
          {extractErrorMessage(toggleActiveMutation.error, {
            fallback: 'We could not change this tour’s active state.',
          })}
        </p>
      ) : null}

      <FormModal
        canSave={form.formState.isValid}
        error={editMutation.error}
        isPending={editMutation.isPending}
        onCancel={() => setEditOpen(false)}
        onOpenChange={(next) => !next && setEditOpen(false)}
        onSave={() => {
          void submit();
        }}
        open={editOpen}
        saveLabel="Save tour"
        saveTestId="root-admin-golf-league-home-edit-save"
        testId="root-admin-golf-league-home-edit-modal"
        title="Edit golf tour"
      >
        <form className="space-y-3" onSubmit={submit}>
          <FormField error={form.formState.errors.name?.message} label="Tour name">
            <Input {...form.register('name')} />
          </FormField>
          <FormField
            helperText="A plain catalog-browse filter keyword, e.g. “PGA”."
            label="Match keyword"
          >
            <Input {...form.register('matchKeyword')} />
          </FormField>
        </form>
      </FormModal>
    </Tile>
  );
}
