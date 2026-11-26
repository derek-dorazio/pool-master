import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { replaceEventTiers, type SportEventDto, type SportEventTierDto } from '@/lib/api';
import { tierLabel } from '@poolmaster/shared/display-strings';
import { Button, FormField, FormModal, FormSection, Select, showToast, Text } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { EventFieldEntry } from './event-field-patch';
import {
  eventTiersRequestBody,
  eventTiersSchema,
  eventTiersValuesOf,
  nextTierKey,
  strandedCount,
  type EventTiersValues,
} from './event-tiers-form';
import { fieldWriteKeys } from './use-sport-event';

const logger = getLogger().child({ feature: 'root-admin-event-tiers' });

/**
 * Save writes the tiers, then places the field in them in a second write (the tier replace route).
 * An unexpected failure may be the second one, with the tiers already saved: Save again finishes it.
 */
/**
 * The event's own tiers, from ⚙ (#1890): an optional override of the tiers it copied from its
 * sport league's tier profile. Rename, reorder, add or remove them; Save places the field in the
 * new tiers at once while no tier was set by hand, and otherwise keeps every place, asking where
 * a removed tier's participants go.
 */
export function EventTiersDialog({
  event,
  field,
  onClose,
  tiers,
}: {
  event: SportEventDto;
  field: readonly EventFieldEntry[];
  onClose: () => void;
  tiers: readonly SportEventTierDto[];
}) {
  const testId = 'root-admin-event-tiers-dialog';
  const form = useForm<EventTiersValues>({ resolver: zodResolver(eventTiersSchema), defaultValues: eventTiersValuesOf(tiers), mode: 'onChange' });
  const rows = useFieldArray({ control: form.control, name: 'tiers' });
  const values = useWatch({ control: form.control }) as EventTiersValues;
  const stranded = strandedCount(values, tiers, field);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (submitted: EventTiersValues) => {
      const response = await replaceEventTiers({ path: { eventId: event.id }, body: eventTiersRequestBody(submitted, stranded) });
      if (!response.data?.tiers) throwApiError(response.error, 'The tiers response is missing data.');
    },
    invalidates: [...fieldWriteKeys(event.id), QueryKeys.rootAdmin.manageSport.eventOverview(event.id)],
    onSuccess: () => {
      showToast({ title: `Saved ${event.name}'s tiers`, tone: 'success' });
      onClose();
    },
    onError: (error) => logger.warn({ action: 'event.tiers.save.failed', data: { sportEventId: event.id }, err: error }, 'Tier change was rejected'),
  });

  const reassignChosen = stranded === 0 || values.tiers.some((tier) => tier.tierKey === values.reassignTo);

  return (
    <FormModal
      canSave={form.formState.isValid && form.formState.isDirty && reassignChosen}
      error={saveMutation.error}
      errorContext="eventTiers"
      errorFallback="We could not save these tiers."
      isPending={saveMutation.isPending}
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void form.handleSubmit((submitted) => saveMutation.mutate(submitted))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save tiers"
      testId={testId}
      title={`${event.name} tiers`}
    >
      <div className="grid gap-4">
        <FormSection
          help="These tiers replace the ones copied from the sport league's tier profile. Saving places the field in them again, unless a tier was set by hand."
          testId={`${testId}-tiers`}
          title="Tiers, first to last"
        >
          <div className="grid gap-2">
            {rows.fields.map((row, index) => (
              <div className="flex items-end gap-2" data-testid={`${testId}-row-${String(index)}`} key={row.id}>
                <Text className="flex-1" data-testid={`${testId}-label-${String(index)}`}>{tierLabel(index + 1)}</Text>
                <Button
                  aria-label={`Move tier ${String(index + 1)} up`}
                  data-testid={`${testId}-up-${String(index)}`}
                  disabled={index === 0}
                  onClick={() => rows.move(index, index - 1)}
                  size="xs"
                  type="button"
                  variant="icon"
                >
                  <ArrowUp aria-hidden size={14} />
                </Button>
                <Button
                  aria-label={`Move tier ${String(index + 1)} down`}
                  data-testid={`${testId}-down-${String(index)}`}
                  disabled={index === rows.fields.length - 1}
                  onClick={() => rows.move(index, index + 1)}
                  size="xs"
                  type="button"
                  variant="icon"
                >
                  <ArrowDown aria-hidden size={14} />
                </Button>
                <Button
                  aria-label={`Remove tier ${String(index + 1)}`}
                  data-testid={`${testId}-remove-${String(index)}`}
                  disabled={rows.fields.length === 1}
                  onClick={() => rows.remove(index)}
                  size="xs"
                  type="button"
                  variant="icon"
                >
                  <X aria-hidden size={14} />
                </Button>
              </div>
            ))}
            <div>
              <Button
                data-testid={`${testId}-add`}
                onClick={() => rows.append({ tierKey: nextTierKey([...tiers, ...values.tiers].map((tier) => tier.tierKey)) })}
                size="sm"
                type="button"
                variant="secondary"
              >
                + Add tier
              </Button>
            </div>
          </div>
        </FormSection>
        {stranded > 0 ? (
          <FormField
            help="A tier was set by hand on this event, so automatic tiering is off and everyone keeps their place."
            label={`Move the ${String(stranded)} in removed tiers to`}
          >
            <Select data-testid={`${testId}-reassign`} {...form.register('reassignTo')}>
              <option value="">Choose a tier</option>
              {values.tiers.map((tier, index) => <option key={tier.tierKey} value={tier.tierKey}>{tierLabel(index + 1)}</option>)}
            </Select>
          </FormField>
        ) : null}
      </div>
    </FormModal>
  );
}
