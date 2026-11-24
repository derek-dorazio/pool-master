import { sportVocabulary } from '@poolmaster/shared/domain';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { createParticipant } from '@/lib/api';
import { FormField, FormPage, Input, Select } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildSportLeaguePath, SPORTS_PATH } from './manage-navigation';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { upperFirst } from '@/lib/upper-first';
import { useManagedSport } from './use-managed-sport';

const newPlayerSchema = z.object({
  sportLeagueId: z.string().min(1, 'Choose a sport league'),
  name: z.string().trim().min(1, 'Name is required'),
  shortName: z.string().trim().optional(),
  nationality: z.string().trim().optional(),
});

type NewPlayerValues = z.infer<typeof newPlayerSchema>;

/**
 * Add a participant (a golfer, a horse) to one of the sport's leagues (#1853): a participant
 * belongs to one sport league. The league comes preselected from the list page's, then the page
 * returns to the list.
 */
export function RootAdminParticipantCreatePage() {
  const logger = getLogger().child({
    feature: 'root-admin-participant-create-page',
  });
  const navigate = useNavigate();
  const { sport, sportUrlSegment, definition } = useManagedSport();
  const { participant, sportLeague } = sportVocabulary(definition);
  const leaguesQuery = useSportLeaguesQuery(sport);
  const [searchParams] = useSearchParams();
  const startLeagueId = searchParams.get('sportLeague');
  // Back to the League page's Participants tab it came from (#1866), else the Sports page.
  const participantsPath = (sportLeagueId: string) => `${buildSportLeaguePath(sportUrlSegment, sportLeagueId)}/participants`;
  const cancelPath = startLeagueId ? participantsPath(startLeagueId) : SPORTS_PATH;

  const form = useForm<NewPlayerValues>({
    resolver: zodResolver(newPlayerSchema),
    defaultValues: { sportLeagueId: startLeagueId ?? '', name: '', shortName: '', nationality: '' },
    mode: 'onChange',
  });

  const createMutation = useInvalidatingMutation({
    mutationFn: async (values: NewPlayerValues) => {
      // A participant is its league's kind: a team in a team league (#2001).
      // poolmaster-allow-list-lookup: the league picker's own list, already on screen
      const league = (leaguesQuery.data ?? []).find((row) => row.id === values.sportLeagueId);
      if (!league) {
        throw new Error(`Sport league ${values.sportLeagueId} is not in the loaded league list.`);
      }
      const response = await createParticipant({
        body: {
          sportLeagueId: values.sportLeagueId,
          participantType: league.participantType,
          name: values.name,
          ...(values.shortName?.trim() ? { shortName: values.shortName.trim() } : {}),
          ...(values.nationality?.trim()
            ? { nationality: values.nationality.trim() }
            : {}),
        },
      });
      if (!response.data?.participant) {
        throwApiError(response.error, 'Participant creation response is missing data.');
      }
      return response.data.participant;
    },
    // The new participant joins its league's roster and count.
    invalidates: [QueryKeys.rootAdmin.manageSport.participants, QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess: (created) => navigate(participantsPath(created.sportLeagueId)),
    onError: (error) => {
      logger.warn(
        { action: 'participant.create.failed', err: error },
        'Participant creation was rejected',
      );
    },
  });

  // The league picker needs the sport's leagues, so a failed fetch must say why it stays empty.
  const errorMessage = createMutation.isError
    ? extractErrorMessage(createMutation.error, { fallback: `We could not add this ${participant.one}.` })
    : leaguesQuery.isError
      ? extractErrorMessage(leaguesQuery.error, { fallback: `We could not load ${definition.name.toLowerCase()}'s ${sportLeague.many}.` })
      : undefined;

  return (
    <FormPage
      cancelTo={cancelPath}
      errorMessage={errorMessage}
      isPending={createMutation.isPending}
      isSubmitDisabled={!form.formState.isValid}
      onSubmit={(event) => void form.handleSubmit((values) => createMutation.mutate(values))(event)}
      pendingLabel="Adding..."
      submitLabel={`Add ${participant.one}`}
      submitTestId="root-admin-participant-list-new-save"
      testId="root-admin-participant-create-page"
      title={`Add ${participant.one}`}
    >
      <FormField error={form.formState.errors.sportLeagueId?.message} label={upperFirst(sportLeague.one)}>
        {/* Controlled, so a league chosen by the link shows once the sport's leagues arrive. */}
        <Select
          data-testid="root-admin-participant-list-new-league"
          name="sportLeagueId"
          onChange={(event) => form.setValue('sportLeagueId', event.target.value, { shouldValidate: true })}
          value={form.watch('sportLeagueId')}
        >
          <option value="">{leaguesQuery.data ? `Choose a ${sportLeague.one}` : 'Loading...'}</option>
          {(leaguesQuery.data ?? []).map((league) => (
            <option key={league.id} value={league.id}>{league.name}</option>
          ))}
        </Select>
      </FormField>
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
    </FormPage>
  );
}
