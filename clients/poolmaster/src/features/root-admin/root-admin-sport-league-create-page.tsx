import { sportVocabulary } from '@poolmaster/shared/domain';
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
import { SPORTS_PATH } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { usePlatformPricingProfilesQuery, usePlatformTierProfilesQuery } from './use-profiles';
import { SPORT_LEAGUE_WRITE_INVALIDATES } from './use-update-sport-league';
import { upperFirst } from '@/lib/upper-first';

const newTourSchema = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  platformTierProfileId: z.string().min(1, 'Choose a tier profile'),
  platformPricingProfileId: z.string().min(1, 'Choose a pricing profile'),
});

type NewTourValues = z.infer<typeof newTourSchema>;

/**
 * Create one of a sport's leagues (a golf tour, a racing circuit), naming the tier and pricing
 * profiles it uses (#1844), then return to the list.
 */
export function RootAdminSportLeagueCreatePage() {
  const { sport, definition } = useManagedSport();
  const { sportLeague } = sportVocabulary(definition);
  const listPath = SPORTS_PATH;

  const logger = getLogger().child({
    feature: 'root-admin-sport-league-create-page',
  });
  const navigate = useNavigate();
  const platformTierProfiles = usePlatformTierProfilesQuery().data ?? [];
  const platformPricingProfiles = usePlatformPricingProfilesQuery().data ?? [];

  const form = useForm<NewTourValues>({
    resolver: zodResolver(newTourSchema),
    defaultValues: { name: '', platformTierProfileId: '', platformPricingProfileId: '' },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewTourValues) => {
      const response = await createSportLeague({
        body: {
          sport,
          name: values.name,
          platformTierProfileId: values.platformTierProfileId,
          platformPricingProfileId: values.platformPricingProfileId,
        },
      });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league creation response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: SPORT_LEAGUE_WRITE_INVALIDATES,
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
        error={form.formState.errors.platformTierProfileId?.message}
        helperText="How many tiers a new event starts with, and how its field fills them."
        label="Tier profile"
      >
        <Select data-testid="root-admin-sport-league-list-new-tier-profile" {...form.register('platformTierProfileId')}>
          <option value="">Choose a tier profile</option>
          {platformTierProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </Select>
      </FormField>
      <FormField
        error={form.formState.errors.platformPricingProfileId?.message}
        helperText="The values a synced field is priced with."
        label="Pricing profile"
      >
        <Select data-testid="root-admin-sport-league-list-new-pricing-profile" {...form.register('platformPricingProfileId')}>
          <option value="">Choose a pricing profile</option>
          {platformPricingProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name}</option>
          ))}
        </Select>
      </FormField>
    </FormPage>
  );
}
