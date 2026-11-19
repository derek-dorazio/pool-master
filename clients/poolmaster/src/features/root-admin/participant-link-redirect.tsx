import { Navigate, useParams } from 'react-router';
import { LoadingState } from '@/features/shared/ui';
import { buildSportLeaguePath, SPORTS_PATH } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { useParticipantQuery } from './use-sport-catalog';

/**
 * An old participant address (`participants/:participantId`, its edit page too): the participant
 * now lives on its league's Participants tab (#1866), so the link opens that tab once the
 * participant is read, and the Sports page when it cannot be.
 */
export function ParticipantLinkRedirect() {
  const { sport } = useManagedSport();
  const { participantId = '' } = useParams<{ participantId: string }>();
  const participantQuery = useParticipantQuery(participantId);

  if (participantQuery.data) {
    return <Navigate replace to={`${buildSportLeaguePath(sport, participantQuery.data.sportLeagueId)}/participants`} />;
  }
  if (participantQuery.isError || participantId === '') {
    return <Navigate replace to={SPORTS_PATH} />;
  }
  return <LoadingState body="Opening the participant's league..." testId="root-admin-participant-link-redirect" />;
}
