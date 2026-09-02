import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { adminCreateGolfTournament } from '@/lib/api';
import {
  Button,
  Checkbox,
  FormField,
  Input,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminListGolfSeasonsResponses } from '@/lib/api';
import { GolfTournamentSeasonSelect } from './golf-tournament-season-select';
import { localDateTimeInputToIso } from './golf-admin-utils';

type GolfSeason = AdminListGolfSeasonsResponses[200]['seasons'][number];

const manualFormSchema = z.object({
  name: z.string().trim().min(1, 'Tournament name is required'),
  venue: z.string().trim().optional(),
  location: z.string().trim().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  rounds: z.coerce.number().int().min(1, 'At least one round'),
  releaseAt: z.string().min(1, 'Release date is required'),
  fieldLocksAt: z.string().min(1, 'Field-lock date is required'),
  autoLifecycleEnabled: z.boolean(),
});

type ManualFormValues = z.infer<typeof manualFormSchema>;

export function GolfTournamentManualCreateForm({
  onSeasonChange,
  seasonId,
  seasons,
}: {
  onSeasonChange: (seasonId: string) => void;
  seasonId: string;
  seasons: readonly GolfSeason[];
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-create-page',
  });
  const navigate = useNavigate();

  const form = useForm<ManualFormValues>({
    resolver: zodResolver(manualFormSchema),
    defaultValues: {
      name: '',
      venue: '',
      location: '',
      startDate: '',
      endDate: '',
      rounds: 4,
      releaseAt: '',
      fieldLocksAt: '',
      autoLifecycleEnabled: true,
    },
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: ManualFormValues) => {
      const response = await adminCreateGolfTournament({
        body: {
          name: values.name,
          ...(values.venue?.trim() ? { venue: values.venue.trim() } : {}),
          ...(values.location?.trim() ? { location: values.location.trim() } : {}),
          startDate: localDateTimeInputToIso(values.startDate) ?? values.startDate,
          ...(localDateTimeInputToIso(values.endDate)
            ? { endDate: localDateTimeInputToIso(values.endDate) }
            : {}),
          rounds: values.rounds,
          releaseAt: localDateTimeInputToIso(values.releaseAt) ?? values.releaseAt,
          fieldLocksAt:
            localDateTimeInputToIso(values.fieldLocksAt) ?? values.fieldLocksAt,
          seasonId,
          autoLifecycleEnabled: values.autoLifecycleEnabled,
        },
      });
      if (!response.data?.tournament?.id) {
        throw response.error ?? new Error('Tournament creation response is missing data.');
      }
      return response.data.tournament;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tournaments],
    onSuccess: (tournament) => {
      logger.info(
        { action: 'golf.tournament.create.manual', data: { id: tournament.id } },
        'Created golf tournament manually',
      );
      navigate(`/manage/golf/tournaments/${tournament.id}`);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.create.manual.failed', err: error },
        'Manual golf tournament creation was rejected',
      );
    },
  });

  return (
    <Tile>
      <form
        className="space-y-4"
        data-testid="root-admin-golf-tournament-create-manual-form"
        onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
      >
        <FormField error={form.formState.errors.name?.message} label="Name">
          <Input
            data-testid="root-admin-golf-tournament-create-name"
            {...form.register('name')}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Venue">
            <Input {...form.register('venue')} />
          </FormField>
          <FormField label="Location">
            <Input {...form.register('location')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={form.formState.errors.startDate?.message} label="Starts">
            <Input
              data-testid="root-admin-golf-tournament-create-start"
              type="datetime-local"
              {...form.register('startDate')}
            />
          </FormField>
          <FormField label="Ends (optional)">
            <Input type="datetime-local" {...form.register('endDate')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={form.formState.errors.releaseAt?.message} label="Field release">
            <Input
              data-testid="root-admin-golf-tournament-create-release"
              type="datetime-local"
              {...form.register('releaseAt')}
            />
          </FormField>
          <FormField
            error={form.formState.errors.fieldLocksAt?.message}
            label="Field locks"
          >
            <Input
              data-testid="root-admin-golf-tournament-create-locks"
              type="datetime-local"
              {...form.register('fieldLocksAt')}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={form.formState.errors.rounds?.message} label="Rounds">
            <Input
              data-testid="root-admin-golf-tournament-create-rounds"
              min={1}
              type="number"
              {...form.register('rounds')}
            />
          </FormField>
          <GolfTournamentSeasonSelect
            onChange={onSeasonChange}
            seasons={seasons}
            value={seasonId}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={form.watch('autoLifecycleEnabled')}
            data-testid="root-admin-golf-tournament-create-auto-lifecycle"
            onChange={(event) =>
              form.setValue('autoLifecycleEnabled', event.target.checked)
            }
          />
          Move this tournament through Live and Completed automatically from its round
          schedule.
        </label>

        <div className="flex justify-end gap-3">
          <Button
            data-testid="root-admin-golf-tournament-create-submit"
            disabled={seasonId === '' || createMutation.isPending}
            isLoading={createMutation.isPending}
            type="submit"
          >
            Create tournament
          </Button>
        </div>

        {createMutation.isError ? (
          <p className="text-sm font-medium text-destructive">
            {extractErrorMessage(createMutation.error, {
              fallback: 'We could not create this tournament.',
            })}
          </p>
        ) : null}
      </form>
    </Tile>
  );
}
