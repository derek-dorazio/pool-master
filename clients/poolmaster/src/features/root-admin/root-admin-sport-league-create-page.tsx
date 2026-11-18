import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { createSportLeague } from '@/lib/api';
import { FormField, FormPage, Input, Select } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { formPageSave } from '@/lib/form-page-save';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildSportLeagueListPath } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { usePricingProfilesQuery, useTierProfilesQuery } from './use-profiles';
import { upperFirst } from '@/lib/upper-first';

const newTourSchema = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  matchKeyword: z.string().trim().optional(),
  tierProfileId: z.string().min(1, 'Choose a tier profile'),
  pricingProfileId: z.string().min(1, 'Choose a pricing profile'),
});

type NewTourValues = z.infer<typeof newTourSchema>;

/**
 * Create one of a sport's leagues (a golf tour, a racing circuit), naming the tier and pricing
 * profiles it uses (#1844), then return to the list.
 */
export function RootAdminSportLeagueCreatePage() {
  const { sport, definition } = useManagedSport();
  const { sportLeague } = definition.vocabulary;
  const listPath = buildSportLeagueListPath(sport);

  const logger = getLogger().child({
    feature: 'root-admin-sport-league-create-page',
  });
  const navigate = useNavigate();
  const tierProfiles = useTierProfilesQuery().data ?? [];
  const pricingProfiles = usePricingProfilesQuery().data ?? [];

  const form = useForm<NewTourValues>({
    resolver: zodResolver(newTourSchema),
    defaultValues: { name: '', matchKeyword: '', tierProfileId: '', pricingProfileId: '' },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewTourValues) => {
      const response = await createSportLeague({
        body: {
          sport,
          name: values.name,
          tierProfileId: values.tierProfileId,
          pricingProfileId: values.pricingProfileId,
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
        { action: 'sportLeague.create.failed', err: error },
        'Sport league creation was rejected',
      );
    },
  });

  return (
    <FormPage
      cancelTo={listPath}
      {...formPageSave(form, createMutation, `We could not create this ${sportLeague.one}.`)}
      isSubmitDisabled={!form.formState.isValid}
      pendingLabel="Creating..."
      submitLabel={`Create ${sportLeague.one}`}
      submitTestId="root-admin-sport-league-list-new-save"
      testId="root-admin-sport-league-create-page"
      title={`New ${definition.name.toLowerCase()} ${sportLeague.one}`}
    >
      <FormField error={form.formState.errors.name?.message} label={`${upperFirst(sportLeague.one)} name`}>
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
      <FormField
        error={form.formState.errors.tierProfileId?.message}
        helperText="How many tiers a new event starts with, and how its field fills them."
        label="Tier profile"
      >
        <Select data-testid="root-admin-sport-league-list-new-tier-profile" {...form.register('tierProfileId')}>
          <option value="">Choose a tier profile</option>
          {tierProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </Select>
      </FormField>
      <FormField
        error={form.formState.errors.pricingProfileId?.message}
        helperText="The values a synced field is priced with."
        label="Pricing profile"
      >
        <Select data-testid="root-admin-sport-league-list-new-pricing-profile" {...form.register('pricingProfileId')}>
          <option value="">Choose a pricing profile</option>
          {pricingProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </Select>
      </FormField>
    </FormPage>
  );
}
