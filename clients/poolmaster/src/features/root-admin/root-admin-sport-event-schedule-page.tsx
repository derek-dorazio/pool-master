import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { updateEventRounds } from '@/lib/api';
import type { SportEventDto, SportEventRoundDto } from '@/lib/api';
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
import { useManagedSport } from './use-managed-sport';
import { useSportEventRoundsQuery, useSportEventQuery } from './use-sport-event';
import { useEventRoundLabel } from './use-sport-catalog';

const roundsFormSchema = z.object({
  rounds: z
    .array(
      z.object({
        roundNumber: z.number().int(),
        scheduledDate: z.string().min(1, 'A date is required'),
        scheduledEndAt: z.string().optional(),
      }),
    )
    .min(1),
});

type RoundsFormValues = z.infer<typeof roundsFormSchema>;

function toDefaults(rounds: readonly SportEventRoundDto[]): RoundsFormValues {
  return {
    rounds: rounds.map((round) => ({
      roundNumber: round.roundNumber,
      scheduledDate: toDateTimeLocalValue(round.scheduledDate),
      scheduledEndAt: round.scheduledEndAt
        ? toDateTimeLocalValue(round.scheduledEndAt)
        : '',
    })),
  };
}

/**
 * The round-schedule form: RHF + useFieldArray over the tournament's existing rounds. It only
 * reschedules rounds, never adds one. It mounts once the rounds have loaded, so
 * `defaultValues` seed from them without mirroring the query into state.
 */
function SportEventScheduleForm({
  sportEvent,
  rounds,
}: {
  sportEvent: SportEventDto;
  rounds: readonly SportEventRoundDto[];
}) {
  const eventId = sportEvent.id;
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-schedule-page',
  });
  const navigate = useNavigate();
  const { sport, definition } = useManagedSport();
  const { event, round } = definition.vocabulary;
  const roundLabel = useEventRoundLabel(sportEvent);
  const homePath = buildSportEventPath(sport, eventId);

  const form = useForm<RoundsFormValues>({
    resolver: zodResolver(roundsFormSchema),
    defaultValues: toDefaults(rounds),
    mode: 'onChange',
  });
  const { fields } = useFieldArray({ control: form.control, name: 'rounds' });

  const roundsMutation = useInvalidatingMutation({
    mutationFn: async (values: RoundsFormValues) => {
      const response = await updateEventRounds({
        path: { eventId },
        body: {
          rounds: values.rounds.map((row) => ({
            roundNumber: row.roundNumber,
            scheduledDate:
              localDateTimeInputToIso(row.scheduledDate) ?? row.scheduledDate,
            // A blank end clears it (null), rather than keeping the old one.
            scheduledEndAt: localDateTimeInputToIso(row.scheduledEndAt) ?? null,
          })),
        },
      });
      if (!response.data?.rounds) {
        throwApiError(response.error, `The ${event.one} schedule update response is missing data.`);
      }
      return response.data.rounds;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.rounds(eventId)],
    onSuccess: () => navigate(homePath),
    onError: (error) => {
      logger.warn(
        { action: 'event.rounds.update.failed', err: error },
        'Event rounds update was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={homePath}
      description={`When each ${round.one} starts and ends. The background scheduler moves the ${event.one} along this schedule.`}
      errorMessage={roundsMutation.isError
        ? extractErrorMessage(roundsMutation.error, { fallback: `We could not save the ${round.one} schedule.` })
        : undefined}
      isPending={roundsMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => roundsMutation.mutate(values))(event)}
      pendingLabel="Saving..."
      submitLabel="Save schedule"
      submitTestId="root-admin-sport-event-rounds-save"
      testId="root-admin-sport-event-schedule-page"
      title={`${capitalize(round.one)} schedule`}
    >
      {fields.map((field, index) => (
        <div className="grid gap-3 sm:grid-cols-2" key={field.id}>
          <FormField
            error={form.formState.errors.rounds?.[index]?.scheduledDate?.message}
            label={`${roundLabel(field.roundNumber, fields.length)} date`}
          >
            <Input
              data-testid={`root-admin-sport-event-round-${field.roundNumber}-date`}
              type="datetime-local"
              {...form.register(`rounds.${index}.scheduledDate`)}
            />
          </FormField>
          <FormField label={`${roundLabel(field.roundNumber, fields.length)} end`}>
            <Input
              data-testid={`root-admin-sport-event-round-${field.roundNumber}-end`}
              type="datetime-local"
              {...form.register(`rounds.${index}.scheduledEndAt`)}
            />
          </FormField>
        </div>
      ))}
    </FormPage>
  );
}

/** Reschedule an event's rounds, on a page of its own. */
export function RootAdminSportEventSchedulePage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const { event, round } = useManagedSport().definition.vocabulary;
  const tournamentQuery = useSportEventQuery(eventId);
  const roundsQuery = useSportEventRoundsQuery(eventId);

  useManageBreadcrumbOverride(eventId || undefined, tournamentQuery.data?.name);

  const query = roundsQuery.isError ? roundsQuery : tournamentQuery;

  return (
    <AsyncPage
      error={query.error}
      errorBody={`We could not load this ${event.one}'s ${round.one} schedule right now.`}
      loadingBody={`Loading ${round.one} schedule...`}
      state={
        tournamentQuery.isLoading || roundsQuery.isLoading
          ? 'loading'
          : tournamentQuery.isError || roundsQuery.isError
            ? 'error'
            : roundsQuery.data?.length === 0
              ? 'empty'
              : 'ready'
      }
      emptyBody={`This ${event.one} has no ${round.many} to schedule yet.`}
    >
      {roundsQuery.data && tournamentQuery.data ? (
        <SportEventScheduleForm rounds={roundsQuery.data} sportEvent={tournamentQuery.data} />
      ) : null}
    </AsyncPage>
  );
}
