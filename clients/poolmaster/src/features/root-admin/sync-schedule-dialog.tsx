import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { updateIngestionSchedule, type IngestionScheduleConfigPatch, type SettingsActor } from '@/lib/api';
import { Checkbox, DateDisplay, DetailEditModal, FormField, Input, showToast } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  syncScheduleFormSchema,
  syncScheduleFormValues,
  syncSchedulePatch,
  type SyncScheduleFormValues,
  type SyncScheduleRow,
} from './sync-schedule-rows';

/**
 * One sync's schedule (#1873): how often it runs, which events it covers and who last changed the
 * schedule, with Close and Edit; Edit switches it on or off and changes its interval, and Field's
 * days ahead too (Field always runs, so it has no switch), then comes
 * back to the view (rules/ux-rules.md §12 item 14).
 */
export function SyncScheduleDialog({
  lastChange,
  onClose,
  row,
}: {
  /** When the schedule was last saved and by whom; null while it is on its defaults. */
  lastChange: { at: string; by: SettingsActor | null } | null;
  onClose: () => void;
  row: SyncScheduleRow;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const testId = 'root-admin-sync-schedule-dialog';
  const isField = row.key === 'eventParticipants';
  const form = useForm<SyncScheduleFormValues>({
    resolver: zodResolver(syncScheduleFormSchema),
    defaultValues: syncScheduleFormValues(row),
    mode: 'onChange',
  });

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (patch: IngestionScheduleConfigPatch) => {
      const response = await updateIngestionSchedule({ body: patch });
      if (!response.data) {
        throwApiError(response.error, 'Sync schedule update response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      showToast({ title: `Saved the ${row.sync} schedule`, tone: 'success' });
      setMode('view');
    },
    invalidates: [QueryKeys.rootAdmin.settings],
  });

  const cancelEdit = () => {
    form.reset(syncScheduleFormValues(row));
    saveMutation.reset();
    setMode('view');
  };

  return (
    <DetailEditModal
      canSave={form.formState.isValid && form.formState.isDirty}
      error={saveMutation.error}
      errorFallback="We could not save this schedule."
      facts={[
        { id: 'every', label: 'Every', value: row.every, testId: `${testId}-every` },
        { id: 'which-events', label: 'Which events', value: row.whichEvents, testId: `${testId}-which-events` },
        {
          id: 'last-changed',
          label: 'Last changed',
          value: lastChange === null
            ? 'Never: on the defaults'
            : <><DateDisplay timeStyle={null} value={lastChange.at} /> by {lastChange.by?.name ?? 'an unknown admin'}</>,
          testId: `${testId}-last-changed`,
        },
      ]}
      isPending={saveMutation.isPending}
      mode={mode}
      onCancel={onClose}
      onCancelEdit={cancelEdit}
      onEdit={() => {
        form.reset(syncScheduleFormValues(row));
        setMode('edit');
      }}
      onOpenChange={(open) => (open ? undefined : onClose())}
      onSave={() => void form.handleSubmit((values) => saveMutation.mutate(syncSchedulePatch(row, values)))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save"
      testId={testId}
      title={mode === 'view' ? `${row.sync} sync` : `${row.sync} sync · Edit`}
    >
      <div className="grid gap-4">
        {isField ? null : (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox data-testid={`${testId}-enabled`} {...form.register('enabled')} />
            Runs on its schedule
          </label>
        )}
        <FormField error={form.formState.errors.interval?.message} label={row.unit === 'seconds' ? 'Every, seconds' : 'Every, minutes'}>
          <Input data-testid={`${testId}-interval`} inputMode="numeric" {...form.register('interval')} />
        </FormField>
        {isField ? (
          <FormField error={form.formState.errors.lookaheadDays?.message} label="Days ahead">
            <Input data-testid={`${testId}-lookahead-days`} inputMode="numeric" {...form.register('lookaheadDays')} />
          </FormField>
        ) : null}
      </div>
    </DetailEditModal>
  );
}
