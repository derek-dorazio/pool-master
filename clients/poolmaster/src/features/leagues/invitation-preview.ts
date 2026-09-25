import { getInvitationPreview, type InvitationPreviewResponse } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { throwApiError } from '@/lib/errors';

export type InvitationPreview = InvitationPreviewResponse['invitation'];

export function getInvitationPreviewQueryKey(inviteCode: string) {
  return QueryKeys.invitations.leaguePreview(inviteCode);
}

export async function fetchInvitationPreview(inviteCode: string): Promise<InvitationPreview> {
  const response = await getInvitationPreview({ path: { inviteCode } });
  if (!response.data?.invitation) {
    throwApiError(response.error, 'Invitation preview is missing data.');
  }

  return response.data.invitation;
}
