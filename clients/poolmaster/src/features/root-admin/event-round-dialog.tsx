import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { updateEventRounds, type SportEventDto } from '@/lib/api';
import {
  DateTimeField,
  DetailEditModal,
  formatDateTimeDisplay,
  FormField,
  useDisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { ROUND_STATUS_LABELS, type EventRoundRow } from './event-round-columns';
import {
  roundScheduleRequestBody,
  roundScheduleSchema,
  roundScheduleValuesOf,
  type RoundScheduleValues,
} from './event-round-form';
import { useDetailEditDialog } from './use-detail-edit-dialog';
import { useSettleAgain } from './use-settle-again';

const logger = getLogger().child({ feature: 'root-admin-event-round' });

/**
 * A round on the Event page's Rounds grid (⤢, the Event page spec): when it starts and ends,
 * where it stands and when it was settled. On an event no feed syncs, Edit reschedules it (a
 * rain delay, an irregular schedule), which the background scheduler then follows; a synced
 * event's schedule is the feed's. Once the round has results, Settle again rebuilds the event's
 * contests' boards from them.
 */
export function EventRoundDialog({
  event,
  isSynced,
  onClose,
  row,
}: {
  event: SportEventDto;
  isSynced: boolean;
  onClose: () => void;
  row: EventRoundRow;
}) {
  const preferences = useDisplayPreferences();
  const { timeZone } = preferences;
  const current = roundScheduleValuesOf(row, timeZone);
  const form = useForm<RoundScheduleValues>({
    resolver: zodResolver(roundScheduleSchema),
    defaultValues: current,
    mode: 'onChange',
  });
  const dialog = useDetailEditDialog(form, current, onClose);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: RoundScheduleValues) => {
      const response = await updateEventRounds({
        path: { eventId: event.id },
        body: roundScheduleRequestBody(row, values, timeZone),
      });
      if (!response.data?.rounds)
        throwApiError(response.error, 'The round schedule response is missing data.');
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.rounds(event.id),
      QueryKeys.rootAdmin.manageSport.event(event.id),
    ],
    onSuccess: () => dialog.saved(),
    onError: (error) =>
      logger.warn(
        {
          action: 'event.round.reschedule.failed',
          data: { roundNumber: row.roundNumber },
          err: error,
        },
        'Round reschedule was rejected',
      ),
  });

  const testId = 'root-admin-event-round-dialog';
  const settleAgain = useSettleAgain(event.id, testId);
  const facts: Fact[] = [
    {
      id: 'starts',
      label: 'Starts',
      value: formatDateTimeDisplay(row.scheduledDate, preferences),
      testId: `${testId}-starts`,
    },
    {
      id: 'ends',
      label: 'Ends',
      value: formatDateTimeDisplay(row.scheduledEndAt, preferences, 'Not set'),
      testId: `${testId}-ends`,
    },
    {
      id: 'status',
      label: 'Status',
      value: ROUND_STATUS_LABELS[row.status],
      testId: `${testId}-status`,
    },
    { id: 'results', label: 'Results', value: row.resultCount, testId: `${testId}-results` },
    {
      id: 'settled',
      label: 'Settled',
      value: formatDateTimeDisplay(row.completedAt, preferences, 'Not yet'),
      testId: `${testId}-settled`,
    },
  ];
  const modal = dialog.modalProps(saveMutation);

  return (
    <>
      <DetailEditModal
        {...modal}
        actions={row.resultCount > 0 ? [settleAgain.action] : undefined}
        canSave={form.formState.isValid && form.formState.isDirty}
        errorFallback="We could not save this round's schedule."
        facts={facts}
        factsTitle="Details"
        onEdit={isSynced ? undefined : modal.onEdit}
        open={!settleAgain.confirmOpen}
        saveLabel="Save schedule"
        testId={testId}
        title={dialog.mode === 'view' ? row.label : `${row.label} · Edit`}
      >
        <div className="grid gap-4">
          <FormField error={form.formState.errors.scheduledDate?.message} label="Starts">
            <DateTimeField
              data-testid={`${testId}-edit-starts`}
              {...form.register('scheduledDate')}
            />
          </FormField>
          <FormField label="Ends" optional>
            <DateTimeField
              data-testid={`${testId}-edit-ends`}
              {...form.register('scheduledEndAt')}
            />
          </FormField>
        </div>
      </DetailEditModal>
      {settleAgain.confirmDialog}
    </>
  );
}
