import { zodResolver } from '@hookform/resolvers/zod';
import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import type { SportLeagueDto } from '@/lib/api';
import { FormField, FormPage, Input } from '@/features/shared/ui';
import { formPageSave } from '@/lib/form-page-save';
import { buildSportLeaguePath, capitalize } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { SportLeaguePage } from './sport-league-page';
import { useUpdateSportLeague } from './use-update-sport-league';

const editSchema = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  matchKeyword: z.string().trim().optional(),
});

type EditValues = z.infer<typeof editSchema>;

function SportLeagueEditForm({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const navigate = useNavigate();
  const { sport } = useManagedSport();
  const sportLeagueNoun = sportLeagueNounOf(sport, sportLeague.noun);
  const homePath = buildSportLeaguePath(sport, sportLeague.id);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: sportLeague.name, matchKeyword: sportLeague.matchKeyword ?? '' },
    mode: 'onChange',
  });

  const updateMutation = useUpdateSportLeague({
    failedAction: 'sportLeague.update.failed',
    onSuccess: () => void navigate(homePath),
    refusedMessage: 'Sport league update was rejected',
    sportLeagueId: sportLeague.id,
    toBody: (values: EditValues) => ({ name: values.name, matchKeyword: values.matchKeyword?.trim() ?? '' }),
  });

  return (
    <FormPage
      cancelTo={homePath}
      {...formPageSave(form, updateMutation, `We could not save this ${sportLeagueNoun.one}.`)}
      isSubmitDisabled={!form.formState.isValid}
      pendingLabel="Saving..."
      submitLabel={`Save ${sportLeagueNoun.one}`}
      submitTestId="root-admin-sport-league-edit-save"
      testId="root-admin-sport-league-edit-page"
      title="Edit details"
    >
      <FormField error={form.formState.errors.name?.message} label={`${capitalize(sportLeagueNoun.one)} name`}>
        <Input data-testid="root-admin-sport-league-edit-name" {...form.register('name')} />
      </FormField>
      <FormField
        helperText="A word a provider's event names carry, to filter its catalog when browsing."
        label="Match keyword"
      >
        <Input data-testid="root-admin-sport-league-edit-keyword" {...form.register('matchKeyword')} />
      </FormField>
    </FormPage>
  );
}

/** Edit a sport league's name and match keyword, with one Save. */
export function RootAdminSportLeagueEditPage() {
  return <SportLeaguePage>{(sportLeague) => <SportLeagueEditForm sportLeague={sportLeague} />}</SportLeaguePage>;
}
