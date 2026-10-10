import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { createParticipant } from '@/lib/api';
import { FormField, FormPage, Input } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { GOLF_PLAYER_LIST_PATH } from './manage-navigation';
import { useGolfSportQuery } from './use-golf-catalog';

const newPlayerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  shortName: z.string().trim().optional(),
  nationality: z.string().trim().optional(),
  externalId: z.string().trim().optional(),
});

type NewPlayerValues = z.infer<typeof newPlayerSchema>;

/** Add a golfer to the master roster, then return to the players list. */
export function RootAdminGolfPlayerCreatePage() {
  const logger = getLogger().child({
    feature: 'root-admin-golf-player-create-page',
  });
  const navigate = useNavigate();
  const sportQuery = useGolfSportQuery();

  const form = useForm<NewPlayerValues>({
    resolver: zodResolver(newPlayerSchema),
    defaultValues: { name: '', shortName: '', nationality: '', externalId: '' },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewPlayerValues) => {
      // #311: Save waits for the sport, but a submit by Enter is not gated by the
      // button, so this still refuses when the sport is missing.
      if (!sportQuery.data) {
        throw new Error('The golf sport is still loading. Wait a moment and try again.');
      }
      const response = await createParticipant({
        body: {
          sportId: sportQuery.data.id,
          participantType: 'INDIVIDUAL',
          name: values.name,
          ...(values.shortName?.trim() ? { shortName: values.shortName.trim() } : {}),
          ...(values.nationality?.trim()
            ? { nationality: values.nationality.trim() }
            : {}),
          ...(values.externalId?.trim() ? { externalId: values.externalId.trim() } : {}),
        },
      });
      if (!response.data?.participant) {
        throwApiError(response.error, 'Golf player creation response is missing data.');
      }
      return response.data.participant;
    },
    invalidates: [QueryKeys.rootAdmin.golf.players],
    onSuccess: () => navigate(GOLF_PLAYER_LIST_PATH),
    onError: (error) => {
      logger.warn(
        { action: 'golf.player.create.failed', err: error },
        'Golf player creation was rejected',
      );
    },
  });

  // Save waits for the sport, so a failed sport fetch must say why it stays off.
  const errorMessage = createMutation.isError
    ? extractErrorMessage(createMutation.error, { fallback: 'We could not add this golfer.' })
    : sportQuery.isError
      ? extractErrorMessage(sportQuery.error, { fallback: 'We could not load the golf sport.' })
      : undefined;

  return (
    <FormPage
      cancelTo={GOLF_PLAYER_LIST_PATH}
      errorMessage={errorMessage}
      isPending={createMutation.isPending}
      isSubmitDisabled={!form.formState.isValid || !sportQuery.data}
      onSubmit={(event) => void form.handleSubmit((values) => createMutation.mutate(values))(event)}
      pendingLabel="Adding..."
      submitLabel="Add player"
      submitTestId="root-admin-golf-player-list-new-save"
      testId="root-admin-golf-player-create-page"
      title="Add golf player"
    >
      <FormField error={form.formState.errors.name?.message} label="Name">
        <Input
          data-testid="root-admin-golf-player-list-new-name"
          placeholder="Rory McIlroy"
          {...form.register('name')}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Short name">
          <Input placeholder="R. McIlroy" {...form.register('shortName')} />
        </FormField>
        <FormField label="Nationality">
          <Input placeholder="NIR" {...form.register('nationality')} />
        </FormField>
      </div>
      <FormField
        helperText="Optional. The provider's identifier for this golfer, if known."
        label="External ID"
      >
        <Input {...form.register('externalId')} />
      </FormField>
    </FormPage>
  );
}
