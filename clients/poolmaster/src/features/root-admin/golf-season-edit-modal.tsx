import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { adminUpdateGolfSeason } from '@/lib/api';
import { FormField, FormModal, Input } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminGetGolfSeasonResponses } from '@/lib/api';
import { localDateTimeInputToIso } from './golf-admin-utils';

type GolfSeason = AdminGetGolfSeasonResponses[200]['season'];

const editSeasonSchema = z.object({
  name: z.string().trim().min(1, 'Season name is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
});

type EditSeasonValues = z.infer<typeof editSeasonSchema>;

function toDefaults(season: GolfSeason): EditSeasonValues {
  return {
    name: season.name,
    startDate: season.startDate.slice(0, 10),
    endDate: season.endDate.slice(0, 10),
  };
}

/**
 * plans/124 §6.3 Season Home — inline edit of a season's name / window. Added
 * here because no other surface edits a season; year and tour stay fixed at
 * creation (§4.3). Mount this only while open (`{editOpen && <…/>}`) so the
 * draft seeds fresh from the season each time and a background refetch can't
 * clobber an in-progress edit.
 */
export function GolfSeasonEditModal({
  season,
  seasonId,
  onClose,
}: {
  season: GolfSeason;
  seasonId: string;
  onClose: () => void;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-season-home-page',
  });

  const form = useForm<EditSeasonValues>({
    resolver: zodResolver(editSeasonSchema),
    defaultValues: toDefaults(season),
    mode: 'onChange',
  });

  const editMutation = useInvalidatingMutation({
    mutationFn: async (values: EditSeasonValues) => {
      const response = await adminUpdateGolfSeason({
        path: { seasonId },
        body: {
          name: values.name,
          startDate: localDateTimeInputToIso(values.startDate) ?? values.startDate,
          endDate: localDateTimeInputToIso(values.endDate) ?? values.endDate,
        },
      });
      if (!response.data?.season) {
        throw response.error ?? new Error('Golf season update response is missing data.');
      }
      return response.data.season;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.season(seasonId || null),
      QueryKeys.rootAdmin.golf.seasons(),
    ],
    onSuccess: onClose,
    onError: (error) => {
      logger.warn(
        { action: 'golf.season.update.failed', err: error },
        'Golf season update was rejected',
      );
    },
  });

  const submit = form.handleSubmit((values) => editMutation.mutate(values));

  return (
    <FormModal
      canSave={form.formState.isValid}
      error={editMutation.error}
      isPending={editMutation.isPending}
      onCancel={onClose}
      onOpenChange={(next) => !next && onClose()}
      onSave={() => {
        void submit();
      }}
      open
      saveLabel="Save season"
      saveTestId="root-admin-golf-season-home-edit-save"
      testId="root-admin-golf-season-home-edit-modal"
      title="Edit season"
    >
      <form className="space-y-3" onSubmit={submit}>
        <FormField
          error={form.formState.errors.name?.message}
          helperText="The year and tour are fixed at creation."
          label="Season name"
        >
          <Input {...form.register('name')} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField error={form.formState.errors.startDate?.message} label="Starts">
            <Input type="date" {...form.register('startDate')} />
          </FormField>
          <FormField error={form.formState.errors.endDate?.message} label="Ends">
            <Input type="date" {...form.register('endDate')} />
          </FormField>
        </div>
      </form>
    </FormModal>
  );
}
