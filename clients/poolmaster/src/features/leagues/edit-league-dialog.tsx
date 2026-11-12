import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { LeagueIconKey } from '@poolmaster/shared/domain';
import { updateLeagueDetails, type LeagueDto } from '@/lib/api';
import {
  FormField,
  FormModal,
  IconPalette,
  Input,
  Text,
  Textarea,
} from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { syncLeagueCaches } from './league-cache';
import { LEAGUE_ICON_OPTIONS } from './league-icon-catalog';
import { LeagueIcon } from './league-icon';

const editLeagueFormSchema = z.object({
  name: z.string().trim().min(1, 'League name is required').max(100, 'League name must be 100 characters or fewer'),
  description: z.string().trim().max(500, 'Description must be 500 characters or fewer'),
  iconKey: z.enum(LeagueIconKey),
});

type EditLeagueFormValues = z.infer<typeof editLeagueFormSchema>;

/**
 * League settings › General's Edit: name, description and icon in one dialog with one Save
 * (rules/ux-rules.md §12 item 4: three simple fields, so a dialog, not a page). A save closes it.
 */
export function EditLeagueDialog({ league, onClose, open }: { league: LeagueDto; onClose: () => void; open: boolean }) {
  // Mounted only while open, so each opening starts from the league as it is, and a background
  // refetch never overwrites what the commissioner has typed (rules/react-ui-rules.md §5 Server
  // Data Form-State Hazard).
  return open ? <EditLeagueForm league={league} onClose={onClose} /> : null;
}

function EditLeagueForm({ league, onClose }: { league: LeagueDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<EditLeagueFormValues>({
    resolver: zodResolver(editLeagueFormSchema),
    defaultValues: {
      name: league.name,
      description: league.description ?? '',
      iconKey: league.iconKey,
    },
  });
  const iconKey = form.watch('iconKey');

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: EditLeagueFormValues) => {
      // One request carries all three fields, so a save never lands half-applied. An empty
      // description is left out, which the contract reads as clearing it.
      const response = await updateLeagueDetails({
        path: { id: league.id },
        body: {
          name: values.name,
          ...(values.description ? { description: values.description } : {}),
          iconKey: values.iconKey,
        },
      });
      if (!response.data?.league) {
        throwApiError(response.error, 'League update response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      onClose();
    },
    invalidates: [],
  });

  return (
    <FormModal
      error={saveMutation.isError ? saveMutation.error : null}
      errorFallback="We could not save the league."
      isPending={saveMutation.isPending}
      onCancel={onClose}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
      onSave={() => void form.handleSubmit((values) => saveMutation.mutateAsync(values).catch(() => undefined))()}
      open
      pendingLabel="Saving..."
      saveLabel="Save league"
      saveTestId="edit-league-save"
      size="lg"
      testId="edit-league-dialog"
      title="Edit league"
    >
      <div className="space-y-4">
        <FormField error={form.formState.errors.name?.message} id="edit-league-name" label="League name">
          <Input
            data-testid="edit-league-name"
            disabled={saveMutation.isPending}
            id="edit-league-name"
            type="text"
            {...form.register('name', { onChange: () => saveMutation.reset() })}
          />
        </FormField>

        <FormField
          error={form.formState.errors.description?.message}
          helperText="Optional."
          id="edit-league-description"
          label="Description"
        >
          <Textarea
            data-testid="edit-league-description"
            disabled={saveMutation.isPending}
            id="edit-league-description"
            {...form.register('description', { onChange: () => saveMutation.reset() })}
          />
        </FormField>

        <fieldset className="space-y-2">
          <legend><Text variant="strong">Icon</Text></legend>
          <IconPalette
            aria-label="League icon"
            disabled={saveMutation.isPending}
            onSelect={(key) => form.setValue('iconKey', key, { shouldDirty: true })}
            optionTestIdPrefix="league-icon"
            options={LEAGUE_ICON_OPTIONS}
            renderOptionIcon={(icon) => (
              <div className="flex justify-center text-primary">
                <LeagueIcon iconKey={icon.key} size="md" />
              </div>
            )}
            testId="league-icon-palette"
            value={iconKey}
          />
        </fieldset>
      </div>
    </FormModal>
  );
}
