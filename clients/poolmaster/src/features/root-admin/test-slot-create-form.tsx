import { slotLabel } from '@poolmaster/shared/display-strings';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createTestSlot } from '@/lib/api';
import {
  Button,
  DateTimeField,
  dateTimeLocalValueToIso,
  FormField,
  InlineError,
  Input,
  SectionCard,
  Select,
  showToast,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { useSportLeagueStructureQuery } from './use-sport-league-page';

const testSlotSchema = z.object({
  slotDefinitionId: z.string().min(1, 'Choose the slot it plays'),
  label: z.string().trim().min(1, 'A label is required'),
  startsAt: z.string().min(1, 'Start is required'),
  endsAt: z.string(),
});

type TestSlotValues = z.infer<typeof testSlotSchema>;

/**
 * Adds a labelled test slot to the league's current Season (#2004): QA only, never read or written
 * by the sync, and the slot a test event is made on. It plays one of the league's slot definitions.
 */
export function TestSlotCreateForm({ onCreated, sportLeagueId }: { onCreated: (slotId: string) => void; sportLeagueId: string }) {
  const logger = getLogger().child({ feature: 'root-admin-test-slot-create' });
  const { timeZone } = useDisplayPreferences();
  const structureQuery = useSportLeagueStructureQuery(sportLeagueId);
  const definitions = (structureQuery.data ?? []).flatMap((phase) => phase.competitions).flatMap((competition) => competition.slots);

  const form = useForm<TestSlotValues>({
    resolver: zodResolver(testSlotSchema),
    defaultValues: { slotDefinitionId: '', label: '', startsAt: '', endsAt: '' },
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: TestSlotValues) => {
      const endsAt = dateTimeLocalValueToIso(values.endsAt, timeZone);
      const response = await createTestSlot({
        path: { sportLeagueId },
        body: {
          slotDefinitionId: values.slotDefinitionId,
          label: values.label,
          startsAt: dateTimeLocalValueToIso(values.startsAt, timeZone) ?? values.startsAt,
          ...(endsAt === undefined ? {} : { endsAt }),
        },
      });
      if (!response.data?.slot) throwApiError(response.error, 'The test slot creation response is missing data.');
      return response.data.slot;
    },
    invalidates: [QueryKeys.sportLeagues.seasons(sportLeagueId)],
    onSuccess: (slot) => {
      showToast({ title: `Added test slot ${slot.label ?? ''}`, tone: 'success' });
      form.reset();
      onCreated(slot.id);
    },
    onError: (error) => logger.warn({ action: 'test-slot.create.failed', err: error }, 'Test slot creation was rejected'),
  });

  return (
    <SectionCard padded testId="root-admin-test-slot-create" title="New test slot">
      <form
        className="space-y-4"
        data-testid="root-admin-test-slot-create-form"
        onSubmit={(e) => void form.handleSubmit((values) => createMutation.mutate(values))(e)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={form.formState.errors.slotDefinitionId?.message} label="Plays *">
            <Select data-testid="root-admin-test-slot-create-definition" {...form.register('slotDefinitionId')}>
              <option value="">{definitions.length === 0 ? 'No slots in this league' : 'Select a slot'}</option>
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>{slotLabel(definition)}</option>
              ))}
            </Select>
          </FormField>
          <FormField error={form.formState.errors.label?.message} label="Label *">
            <Input data-testid="root-admin-test-slot-create-label" maxLength={64} {...form.register('label')} />
          </FormField>
          <FormField error={form.formState.errors.startsAt?.message} label="Starts *">
            <DateTimeField data-testid="root-admin-test-slot-create-start" {...form.register('startsAt')} />
          </FormField>
          <FormField label="Ends">
            <DateTimeField data-testid="root-admin-test-slot-create-end" {...form.register('endsAt')} />
          </FormField>
        </div>
        <div className="flex justify-end">
          <Button
            data-testid="root-admin-test-slot-create-submit"
            isLoading={createMutation.isPending}
            type="submit"
            variant="secondary"
          >
            Add test slot
          </Button>
        </div>
        {createMutation.isError ? (
          <InlineError>{extractErrorMessage(createMutation.error, { fallback: 'We could not add this test slot.' })}</InlineError>
        ) : null}
      </form>
    </SectionCard>
  );
}
