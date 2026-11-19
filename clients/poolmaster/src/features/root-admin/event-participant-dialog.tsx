import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  replaceEventTierAssignments,
  updateEventParticipants,
  type SportEventDto,
  type SportEventTierDto,
} from '@/lib/api';
import {
  Button,
  ConfirmDialog,
  DetailEditModal,
  DialogSection,
  FactList,
  formatDateTimeDisplay,
  FormField,
  Input,
  Select,
  useDisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { fieldOutLabel } from './event-field-columns';
import type { EventFieldEntry, EventFieldPatch } from './event-field-patch';
import { FIELD_VALUE_SET_BY_LABELS, type EventFieldRow } from './event-field-rows';
import {
  participantCorrection,
  participantSchema,
  participantValuesOf,
  type ParticipantEditable,
  type ParticipantValues,
} from './event-participant-form';
import { eventTiersLocked } from './sport-admin-utils';
import { useDetailEditDialog } from './use-detail-edit-dialog';
import { fieldWriteKeys } from './use-sport-event';

const logger = getLogger().child({ feature: 'root-admin-event-participant' });

function shown(value: number | string | null): string {
  return value === null ? 'Not set' : String(value);
}

/**
 * A field participant on the Event page's Field grid (⤢, the Event page spec): its details, then
 * its tier and price, with Withdraw (or Return to field) and Edit. Edit corrects the tier and price
 * until release, and the rank, odds and seed of an event no feed sets them on. A manual tier or
 * price stops that kind following automatic tiering or pricing for the event.
 */
export function EventParticipantDialog({
  event,
  field,
  isSynced,
  onClose,
  row,
  tiers,
}: {
  event: SportEventDto;
  field: readonly EventFieldEntry[];
  isSynced: boolean;
  onClose: () => void;
  row: EventFieldRow;
  tiers: readonly SportEventTierDto[];
}) {
  const preferences = useDisplayPreferences();
  const { entry } = row;
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const editable: ParticipantEditable = { tierAndPrice: !eventTiersLocked(event.status), orderValues: !isSynced };
  const current = participantValuesOf(entry, tiers);
  const form = useForm<ParticipantValues>({ resolver: zodResolver(participantSchema), defaultValues: current, mode: 'onChange' });
  const dialog = useDetailEditDialog(form, current, onClose);
  const invalidates = [...fieldWriteKeys(event.id), QueryKeys.rootAdmin.manageSport.eventOverview(event.id)];

  const patchField = async (patch: EventFieldPatch) => {
    const response = await updateEventParticipants({ path: { eventId: event.id }, body: { participants: [patch] } });
    if (!response.data?.participants) throwApiError(response.error, 'Field save response is missing data.');
  };

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: ParticipantValues) => {
      const { patch, tierMove } = participantCorrection(values, current, entry, { editable, field, tiers });
      if (patch !== null) await patchField(patch);
      if (tierMove !== null) {
        const response = await replaceEventTierAssignments({ path: { eventId: event.id }, body: { assignments: [tierMove] } });
        if (!response.data) throwApiError(response.error, 'Tier assignment response is missing data.');
      }
    },
    invalidates,
    onSuccess: () => dialog.saved(),
    onError: (error) => logger.warn({ action: 'event.participant.save.failed', data: { sportEventParticipantId: entry.id }, err: error }, 'Participant correction was rejected'),
  });

  const withdrawMutation = useInvalidatingMutation({
    mutationFn: () => patchField(entry.isActive
      ? { sportEventParticipantId: entry.id, isActive: false, inactiveReason: 'WITHDRAWN' }
      : { sportEventParticipantId: entry.id, isActive: true }),
    invalidates,
    onSuccess: () => setWithdrawOpen(false),
    onError: (error) => logger.warn({ action: 'event.participant.withdraw.failed', data: { sportEventParticipantId: entry.id }, err: error }, 'Withdrawal change was rejected'),
  });

  const testId = 'root-admin-event-participant-dialog';
  const facts: Fact[] = [
    { id: 'participant', label: 'Participant', value: entry.affiliatedWithSportLeague ? row.name : `${row.name} (guest)`, testId: `${testId}-participant` },
    { id: 'inField', label: 'In field', value: entry.isActive ? 'Yes' : fieldOutLabel(entry), testId: `${testId}-in-field` },
    ...(row.teamAffiliation === null ? [] : [{ id: 'team', label: 'Team', value: row.teamAffiliation }]),
    ...(row.nationality === null ? [] : [{ id: 'country', label: 'Country', value: row.nationality }]),
    { id: 'seed', label: 'Seed', value: shown(row.seedNumber), testId: `${testId}-seed` },
    { id: 'rank', label: 'Rank', value: shown(row.ranking), testId: `${testId}-rank` },
    { id: 'odds', label: 'Odds', value: shown(row.oddsToWin), testId: `${testId}-odds` },
    ...(isSynced
      ? [
        { id: 'feedId', label: 'Feed id', value: row.feedId ?? 'None', testId: `${testId}-feed-id` },
        { id: 'lastInFeed', label: 'Last in feed', value: formatDateTimeDisplay(row.lastInFeedAt, preferences, 'Never'), testId: `${testId}-last-in-feed` },
      ]
      : []),
  ];
  const tierFacts: Fact[] = [
    { id: 'tier', label: 'Tier', value: row.tierLabel ?? 'Untiered', testId: `${testId}-tier` },
    { id: 'price', label: 'Price', value: shown(row.price), testId: `${testId}-price` },
    { id: 'setBy', label: 'Set by', value: row.setBy === null ? 'Not set' : FIELD_VALUE_SET_BY_LABELS[row.setBy], testId: `${testId}-set-by` },
  ];
  const canEdit = editable.tierAndPrice || editable.orderValues;
  const modal = dialog.modalProps(saveMutation);

  return (
    <>
      <DetailEditModal
        {...modal}
        canSave={form.formState.isValid && form.formState.isDirty}
        errorFallback="We could not save these corrections."
        facts={facts}
        factsTitle="Details"
        onEdit={canEdit ? modal.onEdit : undefined}
        open={!withdrawOpen}
        saveLabel="Save corrections"
        testId={testId}
        title={dialog.mode === 'view' ? row.name : `${row.name} · Edit`}
        viewActions={(
          <Button data-testid={`${testId}-withdraw`} onClick={() => setWithdrawOpen(true)} type="button" variant="secondary">
            {entry.isActive ? 'Withdraw' : 'Return to field'}
          </Button>
        )}
        viewContent={(
          <DialogSection testId={`${testId}-tier-and-price`} title="Tier and price">
            <FactList facts={tierFacts} />
          </DialogSection>
        )}
      >
        <div className="grid gap-4">
          {editable.tierAndPrice ? (
            <>
              <FormField helperText="A manual tier stops automatic tiering for this event." label="Tier">
                <Select data-testid={`${testId}-edit-tier`} {...form.register('tierKey')}>
                  {current.tierKey === '' ? <option value="">Untiered</option> : null}
                  {tiers.map((tier) => <option key={tier.id} value={tier.tierKey}>{tier.label}</option>)}
                </Select>
              </FormField>
              <FormField error={form.formState.errors.price?.message} helperText="A manual price stops automatic pricing for this event." label="Price">
                <Input data-testid={`${testId}-edit-price`} inputMode="numeric" {...form.register('price')} />
              </FormField>
            </>
          ) : null}
          {editable.orderValues ? (
            <>
              <FormField error={form.formState.errors.seedNumber?.message} label="Seed">
                <Input data-testid={`${testId}-edit-seed`} inputMode="numeric" {...form.register('seedNumber')} />
              </FormField>
              <FormField error={form.formState.errors.ranking?.message} label="Rank">
                <Input data-testid={`${testId}-edit-rank`} inputMode="numeric" {...form.register('ranking')} />
              </FormField>
              <FormField error={form.formState.errors.oddsToWin?.message} label="Odds">
                <Input data-testid={`${testId}-edit-odds`} inputMode="decimal" {...form.register('oddsToWin')} />
              </FormField>
            </>
          ) : null}
        </div>
      </DetailEditModal>
      <ConfirmDialog
        confirmLabel={entry.isActive ? 'Withdraw' : 'Return to field'}
        confirmTestId={`${testId}-withdraw-confirm`}
        description={entry.isActive
          ? 'It is marked withdrawn and leaves the field.'
          : 'It rejoins the field.'}
        error={withdrawMutation.isError ? extractErrorMessage(withdrawMutation.error, { fallback: 'The change was rejected.' }) : undefined}
        isPending={withdrawMutation.isPending}
        onCancel={() => setWithdrawOpen(false)}
        onConfirm={() => withdrawMutation.mutate()}
        onOpenChange={(open) => !open && setWithdrawOpen(false)}
        open={withdrawOpen}
        testId={`${testId}-withdraw-modal`}
        title={entry.isActive ? `Withdraw ${row.name}?` : `Return ${row.name} to the field?`}
      />
    </>
  );
}
