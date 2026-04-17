import {
  getTeamOwnerInvitationPreview,
  type GetTeamOwnerInvitationPreviewResponses,
} from '@/lib/api';

export type TeamOwnerInvitationPreview = GetTeamOwnerInvitationPreviewResponses[200]['invitation'];

export function getTeamOwnerInvitationPreviewQueryKey(inviteCode: string) {
  return ['poolmaster', 'team-owner-invitation-preview', inviteCode] as const;
}

export async function fetchTeamOwnerInvitationPreview(
  inviteCode: string,
): Promise<TeamOwnerInvitationPreview> {
  const response = await getTeamOwnerInvitationPreview({ path: { inviteCode } });
  if (!response.data?.invitation) {
    throw response.error ?? new Error('Team-owner invitation preview is missing data.');
  }

  return response.data.invitation;
}
