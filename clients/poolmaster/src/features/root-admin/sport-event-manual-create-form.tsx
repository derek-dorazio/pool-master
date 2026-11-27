import { sportLeagueNounOf, sportVocabulary } from '@poolmaster/shared/domain';
import { slotLabel } from '@poolmaster/shared/display-strings';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { createEvent, type SportLeagueDto } from '@/lib/api';
import {
  Button,
  Checkbox,
  formatDateTimeDisplay,
  FormField,
  InlineError,
  Input,
  Notice,
  SectionCard,
  Select,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { useSportLeagueSeasonsQuery } from '@/features/contests/use-sport-league-seasons';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { SportEventEditionFields } from './sport-event-edition-fields';
import { testEventSlotsOf, isCompleteEdition, type SportEventEdition } from './sport-event-edition';
import { buildSportEventPath } from './manage-navigation';
import { TestSlotCreateForm } from './test-slot-create-form';
import { useManagedSport } from './use-managed-sport';

const manualFormSchema = z.object({
  seasonSlotId: z.string().min(1, 'Choose a test slot'),
  name: z.string().trim().min(1, 'Name is required'),
  venue: z.string().trim(),
  location: z.string().trim(),
  // The server bounds the count (#2008); the form checks only that it is a whole number of rounds.
  rounds: z.string().trim().refine((value) => /^[1-9]\d*$/.test(value), 'Rounds is a whole number, 1 or more'),
  autoLifecycleEnabled: z.boolean(),
});

type ManualFormValues = z.infer<typeof manualFormSchema>;

/**
 * The New test event form (#2004): a test event is made on a free test slot of its league's
 * current Season, and takes the slot's dates and plays the rounds given in it (#2008). Every other
 * event is the sync's. A test slot can be added here first.
 */
export function SportEventManualCreateForm({
  edition,
  onEditionChange,
  sportLeagues,
}: {
  edition: SportEventEdition;
  onEditionChange: (edition: SportEventEdition) => void;
  sportLeagues: readonly SportLeagueDto[];
}) {
  const logger = getLogger().child({ feature: 'root-admin-sport-event-create-page' });
  const navigate = useNavigate();
  const preferences = useDisplayPreferences();
  const { sport, sportUrlSegment } = useManagedSport();
  const { event, participant } = sportVocabulary(sport);
  const sportLeague = sportLeagues.find((candidate) => candidate.id === edition.sportLeagueId);
  const sportLeagueNoun = sportLeagueNounOf(sport, sportLeague?.noun ?? null);
  const seasonsQuery = useSportLeagueSeasonsQuery(edition.sportLeagueId);
  const freeSlots = testEventSlotsOf(seasonsQuery.data ?? []);
  const hasCurrentSeason = sportLeague?.currentSeasonId != null;

  const form = useForm<ManualFormValues>({
    resolver: zodResolver(manualFormSchema),
    defaultValues: { seasonSlotId: '', name: '', venue: '', location: '', rounds: '1', autoLifecycleEnabled: true },
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: ManualFormValues) => {
      const response = await createEvent({
        body: {
          // The form makes a test event on one slot; a test bracket over several slots is made by the test-data loader.
          seasonSlotIds: [values.seasonSlotId],
          name: values.name,
          ...(values.venue === '' ? {} : { venue: values.venue }),
          ...(values.location === '' ? {} : { location: values.location }),
          rounds: Number(values.rounds),
          autoLifecycleEnabled: values.autoLifecycleEnabled,
        },
      });
      if (!response.data?.event.id) {
        throwApiError(response.error, `The ${event.one} creation response is missing data.`);
      }
      return response.data.event;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.events, QueryKeys.sportLeagues.seasons(edition.sportLeagueId)],
    onSuccess: (created) => {
      logger.info({ action: 'event.create.manual', data: { id: created.id } }, 'Created a test event');
      void navigate(buildSportEventPath(sportUrlSegment, created.id));
    },
    onError: (error) => {
      logger.warn({ action: 'event.create.manual.failed', err: error }, 'Test event creation was rejected');
    },
  });

  return (
    <div className="space-y-6">
      <SectionCard padded title="Test event">
        <form
          className="space-y-4"
          data-testid="root-admin-sport-event-create-manual-form"
          onSubmit={(e) => void form.handleSubmit((values) => createMutation.mutate(values))(e)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SportEventEditionFields
              edition={edition}
              onChange={(next) => {
                form.setValue('seasonSlotId', '');
                onEditionChange(next);
              }}
              sportLeagues={sportLeagues}
            />
            <FormField error={form.formState.errors.seasonSlotId?.message} label="Test slot *">
              <Select data-testid="root-admin-sport-event-create-slot" disabled={freeSlots.length === 0} {...form.register('seasonSlotId')} value={form.watch('seasonSlotId')}>
                <option value="">{freeSlots.length === 0 ? 'No free test slot' : 'Select a test slot'}</option>
                {freeSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {`${slotLabel(slot)} · ${slot.label ?? ''} · ${formatDateTimeDisplay(slot.startsAt, preferences)}`}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {isCompleteEdition(edition) && !hasCurrentSeason ? (
            <Notice data-testid="root-admin-sport-event-create-no-season" tone="warning">
              This {sportLeagueNoun.one} has no current Season, so it has no test slots.
            </Notice>
          ) : null}

          <FormField error={form.formState.errors.name?.message} label="Name">
            <Input data-testid="root-admin-sport-event-create-name" {...form.register('name')} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Venue">
              <Input data-testid="root-admin-sport-event-create-venue" {...form.register('venue')} />
            </FormField>
            <FormField label="Location">
              <Input data-testid="root-admin-sport-event-create-location" {...form.register('location')} />
            </FormField>
            <FormField error={form.formState.errors.rounds?.message} label="Rounds">
              <Input data-testid="root-admin-sport-event-create-rounds" inputMode="numeric" {...form.register('rounds')} />
            </FormField>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={form.watch('autoLifecycleEnabled')}
              data-testid="root-admin-sport-event-create-auto-lifecycle"
              onChange={(change) => form.setValue('autoLifecycleEnabled', change.target.checked)}
            />
            Move this {event.one} through Live and Completed automatically.
          </label>

          <p className="text-sm text-muted-foreground">
            The {event.one} starts as a draft that only admins can see, on its slot&apos;s dates. Release it
            for contests once its field is loaded and every {participant.one} is in a tier.
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
            <InlineError>
              {extractErrorMessage(createMutation.error, {
                context: 'createEvent',
                values: { sportLeague: sportLeagueNoun.one, event: event.one },
                fallback: `We could not create this ${event.one}.`,
              })}
            </InlineError>
          ) : null}
        </form>
      </SectionCard>

      {isCompleteEdition(edition) && hasCurrentSeason ? (
        <TestSlotCreateForm
          onCreated={(slotId) => form.setValue('seasonSlotId', slotId, { shouldValidate: true })}
          sportLeagueId={edition.sportLeagueId}
        />
      ) : null}
    </div>
  );
}
