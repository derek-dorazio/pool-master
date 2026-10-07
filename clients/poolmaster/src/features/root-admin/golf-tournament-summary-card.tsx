import { zodResolver } from '@hookform/resolvers/zod';
import { throwApiError } from '@/lib/errors';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { updateEvent } from '@/lib/api';
import {
  Button,
  DefinitionList,
  FormField,
  FormModal,
  Input,
  LinkButton,
  Tile,
  formatDateTimeDisplay,
  toDateTimeLocalValue,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportEventDto, UpdateSportEventRequest } from '@/lib/api';
import {
  localDateTimeInputToIso,
} from './golf-admin-utils';

const editFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  venue: z.string().trim().optional(),
  location: z.string().trim().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  rounds: z.coerce.number().int().min(1, 'At least one round'),
});

type EditFormValues = z.infer<typeof editFormSchema>;

function toDefaults(tournament: SportEventDto): EditFormValues {
  return {
    name: tournament.name,
    venue: tournament.venue || '',
    location: tournament.location || '',
    startDate: toDateTimeLocalValue(tournament.startDate),
    endDate: tournament.endDate ? toDateTimeLocalValue(tournament.endDate) : '',
    rounds: tournament.rounds ?? 1,
  };
}

function toRequestBody(values: EditFormValues): UpdateSportEventRequest {
  return {
    name: values.name,
    // A blank field clears the value (null), rather than storing an empty string.
    venue: values.venue?.trim() || null,
    location: values.location?.trim() || null,
    startDate: localDateTimeInputToIso(values.startDate) ?? values.startDate,
    ...(localDateTimeInputToIso(values.endDate)
      ? { endDate: localDateTimeInputToIso(values.endDate) }
      : {}),
    rounds: values.rounds,
  };
}

/**
 * plans/124 §6.3 block 1 — the Tournament Home summary: read-only detail list
 * plus an inline "Edit details" modal.
 */
export function GolfTournamentSummaryCard({
  eventId,
  tourName,
  tournament,
}: {
  eventId: string;
  tourName: string | undefined;
  tournament: SportEventDto;
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
      const response = await updateEvent({
        path: { eventId },
        body: toRequestBody(values),
      });
      if (!response.data?.event) {
        throwApiError(response.error, 'Golf tournament update response is missing data.');
      }
      return response.data.event;
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
            id: 'tour',
            label: 'Tour',
            value: (
              <LinkButton
                data-testid="root-admin-golf-tournament-home-tour-link"
                size="sm"
                to={`/manage/golf/leagues/${tournament.sportLeagueId}`}
                variant="secondary"
              >
                {tourName ?? 'Open tour'}
              </LinkButton>
            ),
          },
          { id: 'event-year', label: 'Event year', value: tournament.eventYear },
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
          onSubmit={(e) => void form.handleSubmit((values) => updateMutation.mutate(values))(e)}
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
          <FormField
            error={form.formState.errors.rounds?.message}
            helperText="The tour and event year are fixed at creation and cannot be changed."
            label="Rounds"
          >
            <Input min={1} type="number" {...form.register('rounds')} />
          </FormField>
        </form>
      </FormModal>
    </Tile>
  );
}
