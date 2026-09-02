import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { adminUpdateGolfTournamentRounds } from '@/lib/api';
import {
  FormField,
  FormModal,
  Input,
  toDateTimeLocalValue,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  localDateTimeInputToIso,
  type AdminGolfTournamentRound,
} from './golf-admin-utils';

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

function toDefaults(rounds: readonly AdminGolfTournamentRound[]): RoundsFormValues {
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
 * plans/124 §6.3 block 2 — the round-schedule editor. RHF + useFieldArray over
 * the tournament's existing SportEventRound rows; it only reschedules rounds,
 * never adds one. The caller remounts this (via `key`) whenever the modal opens,
 * so `defaultValues` re-seeds from the latest rounds — no query-into-state mirror.
 */
export function GolfTournamentRoundsModal({
  eventId,
  onClose,
  open,
  rounds,
}: {
  eventId: string;
  onClose: () => void;
  open: boolean;
  rounds: readonly AdminGolfTournamentRound[];
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-home-page',
  });

  const form = useForm<RoundsFormValues>({
    resolver: zodResolver(roundsFormSchema),
    defaultValues: toDefaults(rounds),
    mode: 'onChange',
  });
  const { fields } = useFieldArray({ control: form.control, name: 'rounds' });

  const roundsMutation = useInvalidatingMutation({
    mutationFn: async (values: RoundsFormValues) => {
      const response = await adminUpdateGolfTournamentRounds({
        path: { eventId },
        body: {
          rounds: values.rounds.map((row) => ({
            roundNumber: row.roundNumber,
            scheduledDate:
              localDateTimeInputToIso(row.scheduledDate) ?? row.scheduledDate,
            ...(localDateTimeInputToIso(row.scheduledEndAt)
              ? { scheduledEndAt: localDateTimeInputToIso(row.scheduledEndAt) }
              : {}),
          })),
        },
      });
      if (!response.data?.rounds) {
        throw response.error ?? new Error('Golf tournament rounds update response is missing data.');
      }
      return response.data.rounds;
    },
    invalidates: [QueryKeys.rootAdmin.golf.rounds(eventId)],
    onSuccess: () => onClose(),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.rounds.update.failed', err: error },
        'Golf tournament rounds update was rejected',
      );
    },
  });

  return (
    <FormModal
      canSave={form.formState.isValid}
      error={roundsMutation.error}
      isPending={roundsMutation.isPending}
      onCancel={onClose}
      onOpenChange={(next) => !next && onClose()}
      onSave={() => {
        void form.handleSubmit((values) => roundsMutation.mutate(values))();
      }}
      open={open}
      saveLabel="Save schedule"
      saveTestId="root-admin-golf-tournament-rounds-save"
      testId="root-admin-golf-tournament-rounds-modal"
      title="Edit round schedule"
    >
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit((values) => roundsMutation.mutate(values))}
      >
        {fields.map((field, index) => (
          <div className="grid gap-3 sm:grid-cols-2" key={field.id}>
            <FormField
              error={form.formState.errors.rounds?.[index]?.scheduledDate?.message}
              label={`Round ${field.roundNumber} date`}
            >
              <Input
                data-testid={`root-admin-golf-tournament-round-${field.roundNumber}-date`}
                type="datetime-local"
                {...form.register(`rounds.${index}.scheduledDate`)}
              />
            </FormField>
            <FormField label={`Round ${field.roundNumber} end`}>
              <Input
                type="datetime-local"
                {...form.register(`rounds.${index}.scheduledEndAt`)}
              />
            </FormField>
          </div>
        ))}
      </form>
    </FormModal>
  );
}
