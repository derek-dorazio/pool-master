import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { getSportDefinition } from '@poolmaster/shared/domain';
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
import { localDateTimeInputToIso } from './sport-admin-utils';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { buildSportEventPath, capitalize } from './manage-navigation';
import { getScoringFamilyAdminUi } from './scoring-family-admin';
import { useSportEventQuery } from './use-sport-event';

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

/**
 * The details as an update. Par per round is sent only when the event's scoring family reads it;
 * otherwise the field is not shown, and the stored value is left as it is.
 */
function toRequestBody(values: EditFormValues, sendsRoundsPar: boolean): UpdateSportEventRequest {
  return {
    name: values.name,
    // A blank field clears the value (null), rather than storing an empty string.
    venue: values.venue?.trim() || null,
    location: values.location?.trim() || null,
    startDate: localDateTimeInputToIso(values.startDate) ?? values.startDate,
    endDate: localDateTimeInputToIso(values.endDate) ?? null,
    rounds: values.rounds,
    ...(sendsRoundsPar
      ? { roundsPar: values.roundsPar === '' ? null : Number(values.roundsPar) }
      : {}),
  };
}

function SportEventEditForm({ tournament }: { tournament: SportEventDto }) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-edit-page',
  });
  const navigate = useNavigate();
  const homePath = buildSportEventPath(tournament.sport, tournament.id);
  const { vocabulary } = getSportDefinition(tournament.sport);
  const { scoresUnplayedRoundsAgainstPar } = getScoringFamilyAdminUi(tournament.sport);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: toDefaults(tournament),
    mode: 'onChange',
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: async (values: EditFormValues) => {
      const response = await updateEvent({
        path: { eventId: tournament.id },
        body: toRequestBody(values, scoresUnplayedRoundsAgainstPar),
      });
      if (!response.data?.event) {
        throwApiError(response.error, `The ${vocabulary.event.one} update response is missing data.`);
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.event(tournament.id),
      QueryKeys.rootAdmin.manageSport.rounds(tournament.id),
      QueryKeys.rootAdmin.manageSport.events,
    ],
    onSuccess: () => navigate(homePath),
    onError: (error) => {
      logger.warn(
        { action: 'event.update.failed', err: error },
        'Event update was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={homePath}
      description={`The ${vocabulary.sportLeague.one} and event year are fixed at creation and cannot be changed.`}
      errorMessage={updateMutation.isError
        ? extractErrorMessage(updateMutation.error, { fallback: 'We could not save these details.' })
        : undefined}
      isPending={updateMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => updateMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel="Save details"
      submitTestId="root-admin-sport-event-edit-save"
      testId="root-admin-sport-event-edit-page"
      title="Edit details"
    >
      <FormField error={form.formState.errors.name?.message} label="Name">
        <Input data-testid="root-admin-sport-event-edit-name" {...form.register('name')} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Venue">
          <Input data-testid="root-admin-sport-event-edit-venue" {...form.register('venue')} />
        </FormField>
        <FormField label="Location">
          <Input data-testid="root-admin-sport-event-edit-location" {...form.register('location')} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField error={form.formState.errors.startDate?.message} label="Starts">
          <Input type="datetime-local" {...form.register('startDate')} />
        </FormField>
        <FormField label="Ends">
          <Input
            data-testid="root-admin-sport-event-edit-end"
            type="datetime-local"
            {...form.register('endDate')}
          />
        </FormField>
      </div>
      <FormField error={form.formState.errors.rounds?.message} label={capitalize(vocabulary.round.many)}>
        <Input min={1} type="number" {...form.register('rounds')} />
      </FormField>
      {scoresUnplayedRoundsAgainstPar ? (
      <FormField
        error={form.formState.errors.roundsPar?.message}
        helperText="Contests score a round a golfer did not play (cut, withdrawn, no score) as 80 strokes against this par. Leave blank to work it out from players' finished rounds."
        label="Par per round"
      >
        <Input
          data-testid="root-admin-sport-event-edit-rounds-par"
          inputMode="numeric"
          max={ROUNDS_PAR_MAX}
          min={ROUNDS_PAR_MIN}
          type="number"
          {...form.register('roundsPar')}
        />
      </FormField>
      ) : null}
    </FormPage>
  );
}

/**
 * Edit an event's details: name, venue, location, dates, rounds and, for a family that scores
 * unplayed rounds against it, par per round, with one Save.
 */
export function RootAdminSportEventEditPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const tournamentQuery = useSportEventQuery(eventId);
  const tournament = tournamentQuery.data;

  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  return (
    <AsyncPage
      errorBody={extractErrorMessage(tournamentQuery.error, {
        fallback: 'We could not load this event right now.',
      })}
      loadingBody="Loading event..."
      state={tournamentQuery.isLoading ? 'loading' : tournamentQuery.isError ? 'error' : 'ready'}
    >
      {tournament ? <SportEventEditForm tournament={tournament} /> : null}
    </AsyncPage>
  );
}
