import {
  getInvitationPreview,
  type GetInvitationPreviewResponses,
} from '@/lib/api';

export type InvitationPreview = GetInvitationPreviewResponses[200]['invitation'];

export function getInvitationPreviewQueryKey(inviteCode: string) {
  return ['poolmaster', 'invitation-preview', inviteCode] as const;
}

export async function fetchInvitationPreview(inviteCode: string): Promise<InvitationPreview> {
  const response = await getInvitationPreview({ path: { inviteCode } });
  if (!response.data?.invitation) {
    throw response.error ?? new Error('Invitation preview is missing data.');
  }

  return response.data.invitation;
}
