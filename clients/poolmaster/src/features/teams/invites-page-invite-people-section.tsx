import type { QueryKey } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { generateInviteLink, sendLeagueInvitations, type LeagueInvitationDto } from '@/lib/api';
import {
  Button,
  CopyButton,
  FormField,
  Input,
  Notice,
  SectionCard,
  SettingsRows,
  showToast,
  Text,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { buildInviteUrl, describeInviteResult, joinedCount } from './invites-page-helpers';

type InvitesPageInvitePeopleSectionProps = {
  invitationsKey: QueryKey;
  isInactiveLeague: boolean;
  joinLink: LeagueInvitationDto | undefined;
  leagueId: string;
};

/** Invite by email, and the league's join link with Copy. */
export function InvitesPageInvitePeopleSection({ invitationsKey, isInactiveLeague, joinLink, leagueId }: InvitesPageInvitePeopleSectionProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const joinUrl = joinLink ? buildInviteUrl(joinLink.inviteCode) : '';

  const sendInviteMutation = useInvalidatingMutation({
    mutationFn: async (email: string) => {
      const response = await sendLeagueInvitations({
        path: { id: leagueId },
        body: { emails: [email] },
      });
      if (!response.data) {
        throwApiError(response.error, 'Invitation send response is missing data.');
      }
      return response.data;
    },
    onSuccess: (result) => {
      const outcome = describeInviteResult(result);
      if (outcome?.kind === 'sent') {
        showToast({ title: outcome.message, tone: 'success' });
      }
    },
    invalidates: [invitationsKey],
  });

  const inviteLinkMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await generateInviteLink({ path: { id: leagueId }, body: {} });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Invite link generation did not return an invitation.');
      }
      return response.data.invitation;
    },
    invalidates: [invitationsKey],
  });

  async function handleSendInvite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || isInactiveLeague) {
      return;
    }
    try {
      await sendInviteMutation.mutateAsync(email);
      setInviteEmail('');
    } catch {
      // Error state is rendered from the mutation; the typed email stays for a retry.
    }
  }

  const inviteResult = sendInviteMutation.data ? describeInviteResult(sendInviteMutation.data) : null;

  return (
    <SectionCard testId="league-invite-people" title="Invite people">
      <SettingsRows>
        <form className="space-y-3 px-4 py-4" onSubmit={(event) => void handleSendInvite(event)}>
          <FormField helperText="They get their own link by email." label="Invite by email">
            <div className="flex flex-wrap gap-3">
              <Input
                aria-label="Invite by email"
                className="min-w-0 flex-[1_1_16rem]"
                data-testid="league-invite-email"
                disabled={isInactiveLeague}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="member@example.com"
                type="email"
                value={inviteEmail}
              />
              <Button
                data-testid="league-send-invite"
                disabled={sendInviteMutation.isPending || !inviteEmail.trim() || isInactiveLeague}
                type="submit"
              >
                {sendInviteMutation.isPending ? 'Sending...' : 'Send invite'}
              </Button>
            </div>
          </FormField>
          {inviteResult?.kind === 'notice' ? <Notice tone={inviteResult.tone}>{inviteResult.message}</Notice> : null}
          {sendInviteMutation.isError ? (
            <Notice tone="danger">
              {extractErrorMessage(sendInviteMutation.error, { fallback: 'We could not send that invitation.' })}
            </Notice>
          ) : null}
        </form>

        <div className="space-y-3 px-4 py-4">
          <FormField
            helperText={joinLink
              ? `Anyone with the link can join. ${joinedCount(joinLink.currentUses)}.`
              : 'Anyone with the link can join.'}
            label="Join link"
          >
            <div className="flex flex-wrap gap-3">
              <Input
                aria-label="Join link"
                className="min-w-0 flex-[1_1_16rem] font-mono"
                data-testid="league-join-url"
                placeholder="No join link yet"
                readOnly
                value={joinUrl}
              />
              <div className="flex gap-2">
                <CopyButton
                  disabled={!joinLink}
                  failedMessage="Couldn't copy. Select the link and copy it by hand."
                  iconOnly
                  key={joinUrl}
                  label="Copy join link"
                  testId="league-copy-join-url"
                  text={joinUrl}
                  variant="icon"
                />
                <Button
                  data-testid="league-create-join-url"
                  disabled={inviteLinkMutation.isPending || isInactiveLeague}
                  onClick={() => void inviteLinkMutation.mutateAsync().catch(() => undefined)}
                  type="button"
                  variant="secondary"
                >
                  {inviteLinkMutation.isPending ? 'Creating...' : joinLink ? 'New link' : 'Create join link'}
                </Button>
              </div>
            </div>
          </FormField>
          {inviteLinkMutation.isError ? (
            <Notice tone="danger">
              {extractErrorMessage(inviteLinkMutation.error, { fallback: 'We could not create a join link.' })}
            </Notice>
          ) : null}
          {isInactiveLeague ? (
            <Text as="p" data-testid="league-invites-inactive" variant="meta">
              This league is inactive, so nobody new can be invited.
            </Text>
          ) : null}
        </div>
      </SettingsRows>
    </SectionCard>
  );
}
