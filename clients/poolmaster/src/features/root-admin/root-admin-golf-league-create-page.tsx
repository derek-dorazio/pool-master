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
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { GOLF_TOUR_LIST_PATH } from './manage-navigation';

const newTourSchema = z.object({
  name: z.string().trim().min(1, 'Tour name is required'),
  matchKeyword: z.string().trim().optional(),
});

type NewTourValues = z.infer<typeof newTourSchema>;

/** Create a golf tour, then return to the tours list. */
export function RootAdminGolfLeagueCreatePage() {
  useManageBreadcrumbOverride('leagues', 'Tours');

  const logger = getLogger().child({
    feature: 'root-admin-golf-league-create-page',
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
          sport: 'GOLF',
          name: values.name,
          ...(values.matchKeyword?.trim()
            ? { matchKeyword: values.matchKeyword.trim() }
            : {}),
        },
      });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Golf tour creation response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tours],
    onSuccess: () => navigate(GOLF_TOUR_LIST_PATH),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.create.failed', err: error },
        'Golf tour creation was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={GOLF_TOUR_LIST_PATH}
      errorMessage={createMutation.isError
        ? extractErrorMessage(createMutation.error, { fallback: 'We could not create this tour.' })
        : undefined}
      isPending={createMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => createMutation.mutate(values))(event)}
      pendingLabel="Creating..."
      submitLabel="Create tour"
      submitTestId="root-admin-golf-league-list-new-save"
      testId="root-admin-golf-league-create-page"
      title="New golf tour"
    >
      <FormField error={form.formState.errors.name?.message} label="Tour name">
        <Input
          data-testid="root-admin-golf-league-list-new-name"
          placeholder="PGA Tour"
          {...form.register('name')}
        />
      </FormField>
      <FormField
        helperText="Optional. A plain catalog-browse filter keyword, e.g. “PGA”."
        label="Match keyword"
      >
        <Input
          data-testid="root-admin-golf-league-list-new-keyword"
          placeholder="PGA"
          {...form.register('matchKeyword')}
        />
      </FormField>
    </FormPage>
  );
}
