import { enumLabel } from '@poolmaster/shared/display-strings';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  DetailEditModal,
  FormField,
  formatDateTimeDisplay,
  Input,
  showToast,
  useDisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import { updateParticipant, type SportLeagueParticipantOverviewDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { useDetailEditDialog } from './use-detail-edit-dialog';
import {
  editableParticipantFields,
  participantSchema,
  participantUpdateBody,
  participantValuesOf,
  type ParticipantValues,
} from './league-participant-form';

const logger = getLogger().child({ feature: 'root-admin-league-page' });

const FIELD_LABELS: Record<keyof ParticipantValues, string> = {
  name: 'Name',
  shortName: 'Short name',
  nationality: 'Country',
  teamAffiliation: 'Team',
  role: 'Position',
  ranking: 'Rank',
};

/**
 * A participant on the League page's Participants grid (⤢): what it is, then Edit for the fields
 * the feed does not own, with one Save (rules/ux-rules.md §12 item 14).
 */
export function LeagueParticipantDialog({
  onClose,
  participant,
  sportLeagueId,
  sportLeagueName,
}: {
  onClose: () => void;
  participant: SportLeagueParticipantOverviewDto;
  sportLeagueId: string;
  sportLeagueName: string;
}) {
  const preferences = useDisplayPreferences();
  const current = participantValuesOf(participant);
  const form = useForm<ParticipantValues>({ resolver: zodResolver(participantSchema), defaultValues: current, mode: 'onChange' });
  const dialog = useDetailEditDialog(form, current, onClose);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: ParticipantValues) => {
      const response = await updateParticipant({ path: { id: participant.id }, body: participantUpdateBody(current, values) });
      if (!response.data?.participant) throwApiError(response.error, 'Participant update response is missing data.');
      return response.data.participant;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.leagueParticipantOverviews(sportLeagueId)],
    onSuccess: () => {
      showToast({ title: `Saved ${participant.name}`, tone: 'success' });
      dialog.saved();
    },
    onError: (error) => {
      logger.warn({ action: 'leaguePage.participant.failed', data: { participantId: participant.id }, err: error }, 'Participant update was refused');
    },
  });

  const blank = (value: string | null) => value ?? '—';
  const facts: Fact[] = [
    { id: 'name', label: 'Name', value: participant.name, testId: 'root-admin-league-participant-name' },
    { id: 'shortName', label: 'Short name', value: blank(participant.shortName), testId: 'root-admin-league-participant-short-name' },
    { id: 'type', label: 'Type', value: enumLabel('ParticipantType', participant.participantType) },
    { id: 'league', label: 'League', value: sportLeagueName },
    { id: 'rank', label: 'Rank', value: participant.ranking === null ? 'Unranked' : String(participant.ranking), testId: 'root-admin-league-participant-rank' },
    { id: 'feedId', label: 'Feed id', value: blank(participant.feedId) },
    { id: 'lastInFeed', label: 'Last in feed', value: participant.lastInFeedAt === null ? 'Never' : formatDateTimeDisplay(participant.lastInFeedAt, preferences) },
    {
      id: 'added',
      label: 'Added',
      value: `${formatDateTimeDisplay(participant.createdAt, preferences)} · ${enumLabel('ParticipantAddedBy', participant.addedBy)}`,
    },
  ];

  return (
    <DetailEditModal
      {...dialog.modalProps(saveMutation)}
      canSave={form.formState.isValid && form.formState.isDirty}
      errorFallback="We could not save this participant."
      facts={facts}
      saveLabel="Save participant"
      testId="root-admin-league-participant"
      title={dialog.mode === 'view' ? participant.name : `${participant.name} · Edit`}
    >
      <div className="grid gap-4">
        {editableParticipantFields(participant).map((key) => (
          <FormField error={form.formState.errors[key]?.message} key={key} label={FIELD_LABELS[key]}>
            <Input
              data-testid={`root-admin-league-participant-${key}-input`}
              inputMode={key === 'ranking' ? 'numeric' : undefined}
              placeholder={key === 'ranking' ? 'Unranked' : undefined}
              {...form.register(key)}
            />
          </FormField>
        ))}
      </div>
    </DetailEditModal>
  );
}
