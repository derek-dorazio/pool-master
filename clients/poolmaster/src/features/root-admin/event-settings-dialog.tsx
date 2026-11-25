import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  transitionEvent,
  updateEvent,
  type SportEventDto,
  type SportEventOverviewDto,
  type SportLeagueDto,
} from '@/lib/api';
import {
  Button,
  ConfirmDialog,
  DateTimeField,
  DetailEditModal,
  formatDateTimeDisplay,
  FormField,
  Input,
  LinkButton,
  showToast,
  useDisplayPreferences,
  type DetailAction,
  type Fact,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { describeBudgetPricing } from './budget-pricing-format';
import { getScoringFamilyAdminUi } from './scoring-family-admin';
import { EventTiersDialog } from './event-tiers-dialog';
import { formatSportEventStatus, type SportEventDtoStatus } from './sport-admin-utils';
import { useDetailEditDialog } from './use-detail-edit-dialog';
import { useSportEventFieldQuery, useSportEventTiersQuery } from './use-sport-event';
import { settingsRequestBody, settingsSchema, TIER_ORDER_LABELS, valuesOf, type SettingsValues } from './event-settings-form';
import { usePlatformPricingProfilesQuery, usePlatformTierProfilesQuery } from './use-profiles';

const logger = getLogger().child({ feature: 'root-admin-event-settings' });

/**
 * The Event page's ⚙ (#1890): the event's details first, with its status moves and automatic
 * lifecycle as actions, then Edit for the details its feed lacks, with one Save
 * (rules/ux-rules.md §12 item 14).
 */
export function EventSettingsDialog({
  event,
  onClose,
  overview,
  sportLeague,
}: {
  event: SportEventDto;
  onClose: () => void;
  overview: SportEventOverviewDto | undefined;
  sportLeague: SportLeagueDto | undefined;
}) {
  const preferences = useDisplayPreferences();
  const { timeZone } = preferences;
  const { scoresUnplayedRoundsAgainstPar } = getScoringFamilyAdminUi(event);
  const platformTierProfilesQuery = usePlatformTierProfilesQuery();
  const platformPricingProfilesQuery = usePlatformPricingProfilesQuery();
  const [transitionTarget, setTransitionTarget] = useState<SportEventDtoStatus | null>(null);
  const [autoToggleOpen, setAutoToggleOpen] = useState(false);
  const [tiersOpen, setTiersOpen] = useState(false);
  const tiersQuery = useSportEventTiersQuery(event.id);
  const fieldQuery = useSportEventFieldQuery(event.id);
  const current = valuesOf(event, timeZone);

  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: current, mode: 'onChange' });
  const dialog = useDetailEditDialog(form, current, onClose);
  const eventKeys = [QueryKeys.rootAdmin.manageSport.event(event.id), QueryKeys.rootAdmin.manageSport.events];

  const updateMutation = useInvalidatingMutation({
    mutationFn: async (values: SettingsValues) => {
      const response = await updateEvent({
        path: { eventId: event.id },
        body: settingsRequestBody(values, current, { providerSynced: event.providerSynced, sendsRoundsPar: scoresUnplayedRoundsAgainstPar, timeZone }),
      });
      if (!response.data?.event) throwApiError(response.error, 'The event update response is missing data.');
      return response.data.event;
    },
    invalidates: eventKeys,
    onSuccess: () => {
      showToast({ title: `Saved ${event.name}`, tone: 'success' });
      dialog.saved();
    },
    onError: (error) => logger.warn({ action: 'event.update.failed', err: error }, 'Event update was rejected'),
  });

  const transitionMutation = useInvalidatingMutation({
    mutationFn: async (toStatus: SportEventDtoStatus) => {
      const response = await transitionEvent({ path: { eventId: event.id }, body: { toStatus } });
      if (!response.data?.event) throwApiError(response.error, 'The event transition response is missing data.');
      return response.data.event;
    },
    invalidates: eventKeys,
    onSuccess: () => setTransitionTarget(null),
    onError: (error) => logger.warn({ action: 'event.transition.failed', err: error }, 'Event transition was rejected'),
  });

  const autoMutation = useInvalidatingMutation({
    mutationFn: async (autoLifecycleEnabled: boolean) => {
      const response = await updateEvent({ path: { eventId: event.id }, body: { autoLifecycleEnabled } });
      if (!response.data?.event) throwApiError(response.error, 'The event update response is missing data.');
      return response.data.event;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.event(event.id)],
    onSuccess: () => setAutoToggleOpen(false),
    onError: (error) => logger.warn({ action: 'event.auto-lifecycle.failed', err: error }, 'Event auto-lifecycle toggle was rejected'),
  });

  // poolmaster-allow-list-lookup: profiles are platform reference data, a handful of rows
  const platformTierProfileName = platformTierProfilesQuery.data?.find((profile) => profile.id === sportLeague?.platformTierProfileId)?.name ?? '…';
  // poolmaster-allow-list-lookup: profiles are platform reference data, a handful of rows
  const platformPricingProfileName = platformPricingProfilesQuery.data?.find((profile) => profile.id === sportLeague?.platformPricingProfileId)?.name ?? '…';
  const tierOrder = overview === undefined ? '…' : overview.tierOrderBasis === null ? 'No active field' : TIER_ORDER_LABELS[overview.tierOrderBasis];
  const testId = 'root-admin-event-settings-dialog';

  const facts: Fact[] = [
    { id: 'league', label: 'Sport league', value: sportLeague?.name ?? '…', testId: `${testId}-league` },
    { id: 'status', label: 'Status', value: formatSportEventStatus(event.status), testId: `${testId}-status` },
    { id: 'starts', label: 'Starts', value: formatDateTimeDisplay(event.startDate, preferences), testId: `${testId}-starts` },
    { id: 'ends', label: 'Ends', value: formatDateTimeDisplay(event.endDate, preferences, 'Not set'), testId: `${testId}-ends` },
    { id: 'venue', label: 'Venue', value: event.venue ?? 'Not set', testId: `${testId}-venue` },
    { id: 'location', label: 'Location', value: event.location ?? 'Not set', testId: `${testId}-location` },
    { id: 'rounds', label: 'Rounds', value: event.rounds ?? 'Not set', testId: `${testId}-rounds` },
    ...(scoresUnplayedRoundsAgainstPar
      ? [{ id: 'par', label: 'Par per round', value: event.roundsPar ?? 'From scores', testId: `${testId}-par` }]
      : []),
    { id: 'feedId', label: 'Feed id', value: event.providerSynced ? event.externalId : 'None', testId: `${testId}-feed-id` },
    { id: 'platformTierProfile', label: 'Tier profile', value: platformTierProfileName, testId: `${testId}-tier-profile` },
    {
      id: 'tiers',
      label: 'Tiers',
      value: tiersQuery.data === undefined ? '…' : tiersQuery.data.length === 0 ? 'None' : [...tiersQuery.data].sort((a, b) => a.tierNumber - b.tierNumber).map((tier) => tier.label).join(' · '),
      testId: `${testId}-tiers`,
    },
    { id: 'platformPricingProfile', label: 'Pricing profile', value: platformPricingProfileName, testId: `${testId}-pricing-profile` },
    {
      id: 'pricedWith',
      label: 'Priced with',
      value: event.pricing === null ? 'Not priced yet' : `${event.pricing.profileName}: ${describeBudgetPricing(event.pricing)}`,
      testId: `${testId}-priced-with`,
    },
    {
      id: 'tierOrder',
      label: 'Tier order from',
      value: tierOrder,
      ...(overview !== undefined && overview.tierOrderBasis !== null && !overview.tierOrderCoversField
        ? { detail: 'Not every participant has it; those without go last' }
        : {}),
      testId: `${testId}-tier-order`,
    },
  ];

  const actions: DetailAction[] = [
    ...(overview?.eventPagePath == null ? [] : [{
      id: 'event-page',
      name: 'Event page',
      description: 'The public page that offers this event\'s contests.',
      control: (
        <LinkButton data-testid={`${testId}-open-event-page`} size="sm" to={overview.eventPagePath} variant="secondary">
          Open event page ›
        </LinkButton>
      ),
    }]),
    ...(event.tiersLocked || tiersQuery.data === undefined || fieldQuery.data === undefined ? [] : [{
      id: 'tiers',
      name: 'Tiers',
      description: 'Override the tiers copied from the sport league\'s tier profile, for this event only.',
      control: (
        <Button data-testid={`${testId}-edit-tiers`} onClick={() => setTiersOpen(true)} size="sm" variant="secondary">
          Edit tiers
        </Button>
      ),
    }]),
    ...event.allowedTransitions.map((toStatus) => ({
      id: `transition-${toStatus}`,
      name: `Move to ${formatSportEventStatus(toStatus)}`,
      description: 'This can activate or settle contests downstream and is hard to reverse.',
      control: (
        <Button
          data-testid={`root-admin-sport-event-transition-${toStatus}`}
          onClick={() => setTransitionTarget(toStatus)}
          size="sm"
          variant="secondary"
        >
          Move
        </Button>
      ),
    })),
    {
      id: 'auto-lifecycle',
      name: event.autoLifecycleEnabled ? 'Automatic lifecycle on' : 'Automatic lifecycle off',
      description: event.autoLifecycleEnabled
        ? 'The scheduler moves this event along its round schedule.'
        : 'Every status move is made by hand.',
      control: (
        <Button data-testid="root-admin-sport-event-auto-toggle" onClick={() => setAutoToggleOpen(true)} size="sm" variant="secondary">
          {event.autoLifecycleEnabled ? 'Turn off' : 'Turn on'}
        </Button>
      ),
    },
  ];

  const confirmOpen = transitionTarget !== null || autoToggleOpen || tiersOpen;

  return (
    <>
      <DetailEditModal
        {...dialog.modalProps(updateMutation)}
        actions={actions}
        canSave={form.formState.isValid && form.formState.isDirty}
        errorFallback="We could not save these details."
        facts={facts}
        open={!confirmOpen}
        saveLabel="Save details"
        testId={testId}
        title={dialog.mode === 'view' ? `${event.name} settings` : `${event.name} settings · Edit`}
      >
        <div className="grid gap-4">
          {event.providerSynced ? null : (
            <>
              <FormField error={form.formState.errors.name?.message} label="Name">
                <Input data-testid="root-admin-sport-event-edit-name" {...form.register('name')} />
              </FormField>
              <FormField label="Venue">
                <Input data-testid="root-admin-sport-event-edit-venue" {...form.register('venue')} />
              </FormField>
              <FormField error={form.formState.errors.startDate?.message} label="Starts">
                <DateTimeField data-testid="root-admin-sport-event-edit-start" {...form.register('startDate')} />
              </FormField>
              <FormField label="Ends">
                <DateTimeField data-testid="root-admin-sport-event-edit-end" {...form.register('endDate')} />
              </FormField>
            </>
          )}
          <FormField label="Location">
            <Input data-testid="root-admin-sport-event-edit-location" {...form.register('location')} />
          </FormField>
          <FormField error={form.formState.errors.rounds?.message} label="Rounds">
            <Input data-testid="root-admin-sport-event-edit-rounds" inputMode="numeric" {...form.register('rounds')} />
          </FormField>
          {scoresUnplayedRoundsAgainstPar ? (
            <FormField error={form.formState.errors.roundsPar?.message} label="Par per round">
              <Input
                data-testid="root-admin-sport-event-edit-rounds-par"
                inputMode="numeric"
                placeholder="From scores"
                {...form.register('roundsPar')}
              />
            </FormField>
          ) : null}
        </div>
      </DetailEditModal>
      {tiersOpen && tiersQuery.data !== undefined && fieldQuery.data !== undefined ? (
        <EventTiersDialog event={event} field={fieldQuery.data} onClose={() => setTiersOpen(false)} tiers={tiersQuery.data} />
      ) : null}
      <ConfirmDialog
        confirmLabel={transitionTarget ? `Move to ${formatSportEventStatus(transitionTarget)}` : 'Confirm'}
        confirmTestId="root-admin-sport-event-transition-confirm"
        description="This can activate or settle contests downstream and is hard to reverse."
        error={transitionMutation.isError
          ? extractErrorMessage(transitionMutation.error, { fallback: 'The transition was rejected.' })
          : undefined}
        isPending={transitionMutation.isPending}
        onCancel={() => setTransitionTarget(null)}
        onConfirm={() => transitionTarget && transitionMutation.mutate(transitionTarget)}
        onOpenChange={(open) => !open && setTransitionTarget(null)}
        open={transitionTarget !== null}
        testId="root-admin-sport-event-transition-modal"
        title="Change event status"
        tone="danger"
      />
      <ConfirmDialog
        confirmLabel={event.autoLifecycleEnabled ? 'Turn off automatic lifecycle' : 'Turn on automatic lifecycle'}
        confirmTestId="root-admin-sport-event-auto-confirm"
        description="The scheduler only moves an event along while automatic lifecycle is on."
        error={autoMutation.isError ? extractErrorMessage(autoMutation.error, { fallback: 'The change was rejected.' }) : undefined}
        isPending={autoMutation.isPending}
        onCancel={() => setAutoToggleOpen(false)}
        onConfirm={() => autoMutation.mutate(!event.autoLifecycleEnabled)}
        onOpenChange={(open) => !open && setAutoToggleOpen(false)}
        open={autoToggleOpen}
        testId="root-admin-sport-event-auto-modal"
        title="Automatic lifecycle"
      />
    </>
  );
}
