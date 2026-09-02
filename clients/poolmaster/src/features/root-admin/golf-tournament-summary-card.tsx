import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { adminUpdateGolfTournament } from '@/lib/api';
import {
  Button,
  DefinitionList,
  FormField,
  FormModal,
  Input,
  Tile,
  formatDateTimeDisplay,
  toDateTimeLocalValue,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminUpdateGolfTournamentData } from '@/lib/api';
import {
  localDateTimeInputToIso,
  type AdminGolfTournamentDetail,
} from './golf-admin-utils';

const editFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  venue: z.string().trim().optional(),
  location: z.string().trim().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  releaseAt: z.string().min(1, 'Field release is required'),
  fieldLocksAt: z.string().min(1, 'Field lock is required'),
  rounds: z.coerce.number().int().min(1, 'At least one round'),
});

type EditFormValues = z.infer<typeof editFormSchema>;

function toDefaults(tournament: AdminGolfTournamentDetail): EditFormValues {
  return {
    name: tournament.name,
    venue: tournament.venue || '',
    location: tournament.location || '',
    startDate: toDateTimeLocalValue(tournament.startDate),
    endDate: tournament.endDate ? toDateTimeLocalValue(tournament.endDate) : '',
    releaseAt: toDateTimeLocalValue(tournament.releaseAt),
    fieldLocksAt: toDateTimeLocalValue(tournament.fieldLocksAt),
    rounds: tournament.rounds ?? 1,
  };
}

function toRequestBody(values: EditFormValues): AdminUpdateGolfTournamentData['body'] {
  return {
    name: values.name,
    venue: values.venue?.trim() ?? '',
    location: values.location?.trim() ?? '',
    startDate: localDateTimeInputToIso(values.startDate) ?? values.startDate,
    ...(localDateTimeInputToIso(values.endDate)
      ? { endDate: localDateTimeInputToIso(values.endDate) }
      : {}),
    releaseAt: localDateTimeInputToIso(values.releaseAt) ?? values.releaseAt,
    fieldLocksAt: localDateTimeInputToIso(values.fieldLocksAt) ?? values.fieldLocksAt,
    rounds: values.rounds,
  };
}

/**
 * plans/124 §6.3 block 1 — the Tournament Home summary: read-only detail list
 * plus an inline "Edit details" modal (hidden for a fully provider-owned event).
 */
export function GolfTournamentSummaryCard({
  eventId,
  readOnly,
  seasonName,
  tournament,
}: {
  eventId: string;
  readOnly: boolean;
  seasonName: string | undefined;
  tournament: AdminGolfTournamentDetail;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-home-page',
  });
  const [open, setOpen] = useState(false);

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: toDefaults(tournament),
    mode: 'onChange',
  });

  const updateMutation = useInvalidatingMutation({
    mutationFn: async (values: EditFormValues) => {
      const response = await adminUpdateGolfTournament({
        path: { eventId },
        body: toRequestBody(values),
      });
      if (!response.data?.tournament) {
        throw response.error ?? new Error('Golf tournament update response is missing data.');
      }
      return response.data.tournament;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.rounds(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
    ],
    onSuccess: () => setOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.update.failed', err: error },
        'Golf tournament update was rejected',
      );
    },
  });

  return (
    <Tile>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Summary</h2>
        {!readOnly ? (
          <Button
            data-testid="root-admin-golf-tournament-home-edit"
            onClick={() => {
              form.reset(toDefaults(tournament));
              setOpen(true);
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            Edit details
          </Button>
        ) : null}
      </div>

      <DefinitionList
        className="mt-4"
        items={[
          { id: 'name', label: 'Name', value: tournament.name },
          { id: 'venue', label: 'Venue', value: tournament.venue || 'Not set' },
          {
            id: 'location',
            label: 'Location',
            value: tournament.location || 'Not set',
          },
          {
            id: 'starts',
            label: 'Starts',
            value: formatDateTimeDisplay(tournament.startDate),
          },
          {
            id: 'ends',
            label: 'Ends',
            value: formatDateTimeDisplay(tournament.endDate),
          },
          { id: 'rounds', label: 'Rounds', value: tournament.rounds ?? 'Not set' },
          {
            id: 'season',
            label: 'Season',
            value: seasonName ?? tournament.seasonId ?? 'Not set',
          },
        ]}
      />

      <FormModal
        canSave={form.formState.isValid}
        error={updateMutation.error}
        isPending={updateMutation.isPending}
        onCancel={() => setOpen(false)}
        onOpenChange={(next) => !next && setOpen(false)}
        onSave={() => {
          void form.handleSubmit((values) => updateMutation.mutate(values))();
        }}
        open={open}
        saveLabel="Save details"
        saveTestId="root-admin-golf-tournament-home-edit-save"
        testId="root-admin-golf-tournament-home-edit-modal"
        title="Edit tournament details"
      >
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
        >
          <FormField error={form.formState.errors.name?.message} label="Name">
            <Input {...form.register('name')} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Venue">
              <Input {...form.register('venue')} />
            </FormField>
            <FormField label="Location">
              <Input {...form.register('location')} />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              error={form.formState.errors.startDate?.message}
              label="Starts"
            >
              <Input type="datetime-local" {...form.register('startDate')} />
            </FormField>
            <FormField label="Ends">
              <Input type="datetime-local" {...form.register('endDate')} />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              error={form.formState.errors.releaseAt?.message}
              label="Field release"
            >
              <Input type="datetime-local" {...form.register('releaseAt')} />
            </FormField>
            <FormField
              error={form.formState.errors.fieldLocksAt?.message}
              label="Field locks"
            >
              <Input type="datetime-local" {...form.register('fieldLocksAt')} />
            </FormField>
          </div>
          <FormField
            error={form.formState.errors.rounds?.message}
            helperText="The season is fixed at creation and cannot be changed."
            label="Rounds"
          >
            <Input min={1} type="number" {...form.register('rounds')} />
          </FormField>
        </form>
      </FormModal>
    </Tile>
  );
}
