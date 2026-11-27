import { ParticipantAddedBy } from '@poolmaster/shared/domain';
import { z } from 'zod';
import type { SportLeagueParticipantOverviewDto, UpdateParticipantData } from '@/lib/api';

/** What the participant dialog's form accepts. */
export const participantSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(500),
  shortName: z.string().trim().max(100),
  nationality: z.string().trim().max(10, 'Use a country code of up to 10 letters'),
  ranking: z.string().trim().refine((value) => value === '' || /^\d+$/.test(value), 'Enter a whole number, or leave it empty for unranked'),
});

export type ParticipantValues = z.infer<typeof participantSchema>;

/** The dialog's form values for a participant as it is now. */
export function participantValuesOf(participant: SportLeagueParticipantOverviewDto): ParticipantValues {
  return {
    name: participant.name,
    shortName: participant.shortName ?? '',
    nationality: participant.nationality ?? '',
    ranking: participant.ranking === null ? '' : String(participant.ranking),
  };
}

/**
 * The fields a root admin may change: what the feed does not send (short name, country, rank),
 * and on a participant added by hand its name too, since no sync keeps it. A player's team and
 * position are their roster row's, which the roster sync writes.
 */
export function editableParticipantFields(participant: Pick<SportLeagueParticipantOverviewDto, 'addedBy'>): (keyof ParticipantValues)[] {
  const always: (keyof ParticipantValues)[] = ['shortName', 'nationality', 'ranking'];
  return participant.addedBy === ParticipantAddedBy.ADMIN ? ['name', ...always] : always;
}

/** Only the changed fields, so a save never overwrites what a sync wrote since the dialog opened. */
export function participantUpdateBody(current: ParticipantValues, values: ParticipantValues): UpdateParticipantData['body'] {
  const changed = (key: keyof ParticipantValues) => values[key] !== current[key];
  return {
    ...(changed('name') && { name: values.name }),
    ...(changed('shortName') && { shortName: values.shortName }),
    ...(changed('nationality') && { nationality: values.nationality }),
    ...(changed('ranking') && { ranking: values.ranking === '' ? null : Number(values.ranking) }),
  };
}
