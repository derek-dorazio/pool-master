import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { createEvent } from '@/lib/api';
import {
  Button,
  Checkbox,
  DateTimeField,
  dateTimeLocalValueToIso,
  FormField,
  Input,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportLeagueDto } from '@/lib/api';
import { SportEventEditionFields } from './sport-event-edition-fields';
import {
  isCompleteEdition,
  parseEventYear,
  type SportEventEdition,
} from './sport-event-edition';
import { buildSportEventPath, capitalize } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';


const manualFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  venue: z.string().trim().optional(),
  location: z.string().trim().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  rounds: z.coerce.number().int().min(1, 'At least one round'),
  autoLifecycleEnabled: z.boolean(),
});

type ManualFormInput = z.input<typeof manualFormSchema>;
type ManualFormValues = z.infer<typeof manualFormSchema>;

export function SportEventManualCreateForm({
  edition,
  onEditionChange,
  sportLeagues,
}: {
  edition: SportEventEdition;
  onEditionChange: (edition: SportEventEdition) => void;
  sportLeagues: readonly SportLeagueDto[];
}) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-create-page',
  });
  const navigate = useNavigate();
  const { sport, definition } = useManagedSport();
  const { timeZone } = useDisplayPreferences();
  const { event, participant, round } = definition.vocabulary;
  const sportLeagueNoun = sportLeagueNounOf(sport, sportLeagues.find((sportLeague) => sportLeague.id === edition.sportLeagueId)?.noun ?? null);

  const form = useForm<ManualFormInput, unknown, ManualFormValues>({
    resolver: zodResolver(manualFormSchema),
    defaultValues: {
      name: '',
      venue: '',
      location: '',
      startDate: '',
      endDate: '',
      rounds: definition.defaultRounds,
      autoLifecycleEnabled: true,
    },
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: ManualFormValues) => {
      const endDate = dateTimeLocalValueToIso(values.endDate, timeZone);
      const response = await createEvent({
        body: {
          name: values.name,
          ...(values.venue?.trim() ? { venue: values.venue.trim() } : {}),
          ...(values.location?.trim() ? { location: values.location.trim() } : {}),
          startDate: dateTimeLocalValueToIso(values.startDate, timeZone) ?? values.startDate,
          ...(endDate ? { endDate } : {}),
          rounds: values.rounds,
          sportLeagueId: edition.sportLeagueId,
          eventYear: parseEventYear(edition.eventYear) as number,
          autoLifecycleEnabled: values.autoLifecycleEnabled,
        },
      });
      if (!response.data?.event.id) {
        throwApiError(response.error, `The ${event.one} creation response is missing data.`);
      }
      return response.data.event;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.events],
    onSuccess: (tournament) => {
      logger.info(
        { action: 'event.create.manual', data: { id: tournament.id } },
        'Created event manually',
      );
      void navigate(buildSportEventPath(sport, tournament.id));
    },
    onError: (error) => {
      logger.warn(
        { action: 'event.create.manual.failed', err: error },
        'Manual event creation was rejected',
      );
    },
  });

  return (
    <Tile>
      <form
        className="space-y-4"
        data-testid="root-admin-sport-event-create-manual-form"
        onSubmit={(e) => void form.handleSubmit((values) => createMutation.mutate(values))(e)}
      >
        <FormField error={form.formState.errors.name?.message} label="Name">
          <Input
            data-testid="root-admin-sport-event-create-name"
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
            <DateTimeField data-testid="root-admin-sport-event-create-start" {...form.register('startDate')} />
          </FormField>
          <FormField label="Ends (optional)">
            <DateTimeField {...form.register('endDate')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={form.formState.errors.rounds?.message} label={capitalize(round.many)}>
            <Input
              data-testid="root-admin-sport-event-create-rounds"
              min={1}
              type="number"
              {...form.register('rounds')}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SportEventEditionFields edition={edition} onChange={onEditionChange} sportLeagues={sportLeagues} />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={form.watch('autoLifecycleEnabled')}
            data-testid="root-admin-sport-event-create-auto-lifecycle"
            onChange={(event) =>
              form.setValue('autoLifecycleEnabled', event.target.checked)
            }
          />
          Move this {event.one} through Live and Completed automatically from its {round.one}{' '}
          schedule.
        </label>

        <p className="text-sm text-muted-foreground">
          The {event.one} starts as a draft that only admins can see. Release it for contests
          from its Workflow card once its field is loaded and every {participant.one} is in a
          tier.
        </p>

        <div className="flex justify-end gap-3">
          <Button
            data-testid="root-admin-sport-event-create-submit"
            disabled={!isCompleteEdition(edition) || createMutation.isPending}
            isLoading={createMutation.isPending}
            type="submit"
          >
            Create {event.one}
          </Button>
        </div>

        {createMutation.isError ? (
          <p className="text-sm font-medium text-destructive">
            {extractErrorMessage(createMutation.error, {
              codeMessages: {
                EVENT_EDITION_ALREADY_EXISTS: `This ${sportLeagueNoun.one} already has a ${edition.eventYear} edition of this ${event.one}.`,
              },
              fallback: `We could not create this ${event.one}.`,
            })}
          </p>
        ) : null}
      </form>
    </Tile>
  );
}
