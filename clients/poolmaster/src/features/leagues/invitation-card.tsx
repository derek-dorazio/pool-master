import type { TeamIconKey } from '@poolmaster/shared/domain';
import { TeamAvatar } from '@/features/teams/team-avatar';
import { SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';

type InvitationCardProps = {
  leagueName: string;
  inviteCode?: string;
  /** The team a co-owner invitation adds you to; a league invitation has none. */
  team?: { name: string; iconKey: TeamIconKey };
  title?: string;
};

/**
 * What an invitation leads to, as rows: the league, the team for a co-owner, what you join as and
 * the invite code. The league join page, the co-owner join page and the sign-in page beside an
 * invite all show this one card, with no sentences around it.
 */
export function InvitationCard({ leagueName, inviteCode, team, title = 'Invitation' }: InvitationCardProps) {
  return (
    <SectionCard headingLevel={3} testId="invitation-context-card" title={title}>
      <SectionRows>
        <SectionRow layout="setting" name="League" testId="invitation-card-league" value={leagueName} />
        {team ? (
          <SectionRow
            aside={<TeamAvatar iconKey={team.iconKey} size="sm" />}
            layout="setting"
            name="Team"
            testId="invitation-card-team"
            value={team.name}
          />
        ) : null}
        <SectionRow
          layout="setting"
          name="You join as"
          testId="invitation-card-role"
          value={team ? 'A co-owner' : 'A member, with your own team'}
        />
        {inviteCode ? (
          <SectionRow layout="setting" name="Invite code" testId="invitation-card-code" value={inviteCode.toUpperCase()} />
        ) : null}
      </SectionRows>
    </SectionCard>
  );
}
