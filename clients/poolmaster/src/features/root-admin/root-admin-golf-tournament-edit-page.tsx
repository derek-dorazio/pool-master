import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ROUNDS_PAR_MAX, ROUNDS_PAR_MIN } from '@poolmaster/shared/dto';
import { updateEvent } from '@/lib/api';
import type { SportEventDto, UpdateSportEventRequest } from '@/lib/api';
import {
  AsyncPage,
  FormField,
  FormPage,
  Input,
  toDateTimeLocalValue,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { localDateTimeInputToIso } from './golf-admin-utils';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { buildGolfTournamentPath } from './manage-navigation';
import { useGolfTournamentQuery } from './use-golf-tournament';

const editFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  venue: z.string().trim().optional(),
  location: z.string().trim().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  rounds: z.coerce.number().int().min(1, 'At least one round'),
  // Blank means "not set": contest scoring then derives each round's par from the field.
  roundsPar: z.string().trim().refine((value) => {
    if (value === '') return true;
    const par = Number(value);
    return Number.isInteger(par) && par >= ROUNDS_PAR_MIN && par <= ROUNDS_PAR_MAX;
  }, `Par is a whole number from ${ROUNDS_PAR_MIN} to ${ROUNDS_PAR_MAX}, or blank`),
});

type EditFormValues = z.infer<typeof editFormSchema>;

function toDefaults(tournament: SportEventDto): EditFormValues {
  return {
    name: tournament.name,
    venue: tournament.venue || '',
    location: tournament.location || '',
    startDate: toDateTimeLocalValue(tournament.startDate),
    endDate: tournament.endDate ? toDateTimeLocalValue(tournament.endDate) : '',
    rounds: tournament.rounds ?? 1,
    roundsPar: tournament.roundsPar === null ? '' : String(tournament.roundsPar),
  };
}

function toRequestBody(values: EditFormValues): UpdateSportEventRequest {
  return {
    name: values.name,
    // A blank field clears the value (null), rather than storing an empty string.
    venue: values.venue?.trim() || null,
    location: values.location?.trim() || null,
    startDate: localDateTimeInputToIso(values.startDate) ?? values.startDate,
    endDate: localDateTimeInputToIso(values.endDate) ?? null,
    rounds: values.rounds,
    roundsPar: values.roundsPar === '' ? null : Number(values.roundsPar),
  };
}

function GolfTournamentEditForm({ tournament }: { tournament: SportEventDto }) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-edit-page',
  });
  const navigate = useNavigate();
  const homePath = buildGolfTournamentPath(tournament.id);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: toDefaults(tournament),
    mode: 'onChange',
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: async (values: EditFormValues) => {
      const response = await updateEvent({
        path: { eventId: tournament.id },
        body: toRequestBody(values),
      });
      if (!response.data?.event) {
        throwApiError(response.error, 'Golf tournament update response is missing data.');
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tournament(tournament.id),
      QueryKeys.rootAdmin.golf.rounds(tournament.id),
      QueryKeys.rootAdmin.golf.tournaments,
    ],
    onSuccess: () => navigate(homePath),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.update.failed', err: error },
        'Golf tournament update was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={homePath}
      description="The tour and event year are fixed at creation and cannot be changed."
      errorMessage={updateMutation.isError
        ? extractErrorMessage(updateMutation.error, { fallback: 'We could not save these details.' })
        : undefined}
      isPending={updateMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => updateMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel="Save details"
      submitTestId="root-admin-golf-tournament-edit-save"
      testId="root-admin-golf-tournament-edit-page"
      title="Edit tournament details"
    >
      <FormField error={form.formState.errors.name?.message} label="Name">
        <Input data-testid="root-admin-golf-tournament-edit-name" {...form.register('name')} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Venue">
          <Input data-testid="root-admin-golf-tournament-edit-venue" {...form.register('venue')} />
        </FormField>
        <FormField label="Location">
          <Input data-testid="root-admin-golf-tournament-edit-location" {...form.register('location')} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField error={form.formState.errors.startDate?.message} label="Starts">
          <Input type="datetime-local" {...form.register('startDate')} />
        </FormField>
        <FormField label="Ends">
          <Input
            data-testid="root-admin-golf-tournament-edit-end"
            type="datetime-local"
            {...form.register('endDate')}
          />
        </FormField>
      </div>
      <FormField error={form.formState.errors.rounds?.message} label="Rounds">
        <Input min={1} type="number" {...form.register('rounds')} />
      </FormField>
      <FormField
        error={form.formState.errors.roundsPar?.message}
        helperText="Contests score a round a golfer did not play (cut, withdrawn, no score) as 80 strokes against this par. Leave blank to work it out from players' finished rounds."
        label="Par per round"
      >
        <Input
          data-testid="root-admin-golf-tournament-edit-rounds-par"
          inputMode="numeric"
          max={ROUNDS_PAR_MAX}
          min={ROUNDS_PAR_MIN}
          type="number"
          {...form.register('roundsPar')}
        />
      </FormField>
    </FormPage>
  );
}

/** Edit a tournament's details: name, venue, location, dates, rounds and par, with one Save. */
export function RootAdminGolfTournamentEditPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const tournamentQuery = useGolfTournamentQuery(eventId);
  const tournament = tournamentQuery.data;

  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  return (
    <AsyncPage
      errorBody={extractErrorMessage(tournamentQuery.error, {
        fallback: 'We could not load this golf tournament right now.',
      })}
      loadingBody="Loading golf tournament..."
      state={tournamentQuery.isLoading ? 'loading' : tournamentQuery.isError ? 'error' : 'ready'}
    >
      {tournament ? <GolfTournamentEditForm tournament={tournament} /> : null}
    </AsyncPage>
  );
}
