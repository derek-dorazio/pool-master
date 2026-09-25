import { type TeamOwnerInvitationPreviewResponse, getTeamOwnerInvitationPreview } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { throwApiError } from '@/lib/errors';

export type TeamOwnerInvitationPreview = TeamOwnerInvitationPreviewResponse['invitation'];

export function getTeamOwnerInvitationPreviewQueryKey(inviteCode: string) {
  return QueryKeys.invitations.teamOwnerPreview(inviteCode);
}

export async function fetchTeamOwnerInvitationPreview(
  inviteCode: string,
): Promise<TeamOwnerInvitationPreview> {
  const response = await getTeamOwnerInvitationPreview({ path: { inviteCode } });
  if (!response.data?.invitation) {
    throwApiError(response.error, 'Team-owner invitation preview is missing data.');
  }

  return response.data.invitation;
}
