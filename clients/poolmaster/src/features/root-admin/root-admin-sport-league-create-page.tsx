import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { createSportLeague } from '@/lib/api';
import { FormField, FormPage, Input } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildSportLeagueListPath, capitalize } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';

const newTourSchema = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  matchKeyword: z.string().trim().optional(),
});

type NewTourValues = z.infer<typeof newTourSchema>;

/** Create one of a sport's leagues (a golf tour, a racing circuit), then return to the list. */
export function RootAdminSportLeagueCreatePage() {
  const { sport, definition } = useManagedSport();
  const { sportLeague } = definition.vocabulary;
  const listPath = buildSportLeagueListPath(sport);

  const logger = getLogger().child({
    feature: 'root-admin-sport-league-create-page',
  });
  const navigate = useNavigate();

  const form = useForm<NewTourValues>({
    resolver: zodResolver(newTourSchema),
    defaultValues: { name: '', matchKeyword: '' },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewTourValues) => {
      const response = await createSportLeague({
        body: {
          sport,
          name: values.name,
          ...(values.matchKeyword?.trim()
            ? { matchKeyword: values.matchKeyword.trim() }
            : {}),
        },
      });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league creation response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess: () => navigate(listPath),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.create.failed', err: error },
        'Sport league creation was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={listPath}
      errorMessage={createMutation.isError
        ? extractErrorMessage(createMutation.error, { fallback: `We could not create this ${sportLeague.one}.` })
        : undefined}
      isPending={createMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => createMutation.mutate(values))(event)}
      pendingLabel="Creating..."
      submitLabel={`Create ${sportLeague.one}`}
      submitTestId="root-admin-sport-league-list-new-save"
      testId="root-admin-sport-league-create-page"
      title={`New ${definition.name.toLowerCase()} ${sportLeague.one}`}
    >
      <FormField error={form.formState.errors.name?.message} label={`${capitalize(sportLeague.one)} name`}>
        <Input
          data-testid="root-admin-sport-league-list-new-name"
          {...form.register('name')}
        />
      </FormField>
      <FormField
        helperText="Optional. A word a provider's event names carry, to filter its catalog when browsing."
        label="Match keyword"
      >
        <Input
          data-testid="root-admin-sport-league-list-new-keyword"
          {...form.register('matchKeyword')}
        />
      </FormField>
    </FormPage>
  );
}
