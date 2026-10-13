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
import { buildSportParticipantListPath } from './manage-navigation';
import { useSportQuery } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

const newPlayerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  shortName: z.string().trim().optional(),
  nationality: z.string().trim().optional(),
  externalId: z.string().trim().optional(),
});

type NewPlayerValues = z.infer<typeof newPlayerSchema>;

/** Add a participant (a golfer, a horse) to the sport's master roster, then return to the list. */
export function RootAdminParticipantCreatePage() {
  const logger = getLogger().child({
    feature: 'root-admin-participant-create-page',
  });
  const navigate = useNavigate();
  const { sport, definition } = useManagedSport();
  const { participant } = definition.vocabulary;
  const listPath = buildSportParticipantListPath(sport);
  const sportQuery = useSportQuery(sport);

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
        throw new Error(`The ${definition.name.toLowerCase()} sport is still loading. Wait a moment and try again.`);
      }
      const response = await createParticipant({
        body: {
          sportId: sportQuery.data.id,
          participantType: definition.participantType,
          name: values.name,
          ...(values.shortName?.trim() ? { shortName: values.shortName.trim() } : {}),
          ...(values.nationality?.trim()
            ? { nationality: values.nationality.trim() }
            : {}),
          ...(values.externalId?.trim() ? { externalId: values.externalId.trim() } : {}),
        },
      });
      if (!response.data?.participant) {
        throwApiError(response.error, 'Participant creation response is missing data.');
      }
      return response.data.participant;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.participants],
    onSuccess: () => navigate(listPath),
    onError: (error) => {
      logger.warn(
        { action: 'golf.player.create.failed', err: error },
        'Participant creation was rejected',
      );
    },
  });

  // Save waits for the sport, so a failed sport fetch must say why it stays off.
  const errorMessage = createMutation.isError
    ? extractErrorMessage(createMutation.error, { fallback: `We could not add this ${participant.one}.` })
    : sportQuery.isError
      ? extractErrorMessage(sportQuery.error, { fallback: `We could not load ${definition.name.toLowerCase()}.` })
      : undefined;

  return (
    <FormPage
      cancelTo={listPath}
      errorMessage={errorMessage}
      isPending={createMutation.isPending}
      isSubmitDisabled={!form.formState.isValid || !sportQuery.data}
      onSubmit={(event) => void form.handleSubmit((values) => createMutation.mutate(values))(event)}
      pendingLabel="Adding..."
      submitLabel={`Add ${participant.one}`}
      submitTestId="root-admin-participant-list-new-save"
      testId="root-admin-participant-create-page"
      title={`Add ${participant.one}`}
    >
      <FormField error={form.formState.errors.name?.message} label="Name">
        <Input
          data-testid="root-admin-participant-list-new-name"
          {...form.register('name')}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Short name">
          <Input {...form.register('shortName')} />
        </FormField>
        <FormField label="Nationality">
          <Input {...form.register('nationality')} />
        </FormField>
      </div>
      <FormField
        helperText={`Optional. The provider's identifier for this ${participant.one}, if known.`}
        label="External ID"
      >
        <Input {...form.register('externalId')} />
      </FormField>
    </FormPage>
  );
}
