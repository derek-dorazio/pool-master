import { ParticipantAddedBy } from '@poolmaster/shared/domain';
import { z } from 'zod';
import type { SportLeagueParticipantOverviewDto, UpdateParticipantData } from '@/lib/api';

/** What the participant dialog's form accepts. */
export const participantSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(500),
  shortName: z.string().trim().max(100),
  nationality: z.string().trim().max(10, 'Use a country code of up to 10 letters'),
  teamAffiliation: z.string().trim().max(255),
  role: z.string().trim().max(50),
  ranking: z.string().trim().refine((value) => value === '' || /^\d+$/.test(value), 'Enter a whole number, or leave it empty for unranked'),
});

export type ParticipantValues = z.infer<typeof participantSchema>;

/** The dialog's form values for a participant as it is now. */
export function participantValuesOf(participant: SportLeagueParticipantOverviewDto): ParticipantValues {
  return {
    name: participant.name,
    shortName: participant.shortName ?? '',
    nationality: participant.nationality ?? '',
    teamAffiliation: participant.teamAffiliation ?? '',
    role: participant.role ?? '',
    ranking: participant.ranking === null ? '' : String(participant.ranking),
  };
}

/**
 * The fields a root admin may change: what the feed does not send (short name, country, rank),
 * and on a participant added by hand its name, team and position too, since no sync keeps them.
 */
export function editableParticipantFields(participant: Pick<SportLeagueParticipantOverviewDto, 'addedBy'>): (keyof ParticipantValues)[] {
  const always: (keyof ParticipantValues)[] = ['shortName', 'nationality', 'ranking'];
  return participant.addedBy === ParticipantAddedBy.ADMIN ? ['name', ...always, 'teamAffiliation', 'role'] : always;
}

/** Only the changed fields, so a save never overwrites what a sync wrote since the dialog opened. */
export function participantUpdateBody(current: ParticipantValues, values: ParticipantValues): UpdateParticipantData['body'] {
  const changed = (key: keyof ParticipantValues) => values[key] !== current[key];
  return {
    ...(changed('name') && { name: values.name }),
    ...(changed('shortName') && { shortName: values.shortName }),
    ...(changed('nationality') && { nationality: values.nationality }),
    ...(changed('teamAffiliation') && { teamAffiliation: values.teamAffiliation }),
    ...(changed('role') && { role: values.role }),
    ...(changed('ranking') && { ranking: values.ranking === '' ? null : Number(values.ranking) }),
  };
}
