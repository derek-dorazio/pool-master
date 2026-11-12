import { getLeagueInitials } from './league-routing';
import { SectionCard, Text } from '@/features/shared/ui';

type InvitationContextCardProps = {
  leagueName: string;
  inviteCode?: string;
  message: string;
  title?: string;
};

/** The league an invitation leads to: a titled section with its initials, name and invite code. */
export function InvitationContextCard({
  leagueName,
  inviteCode,
  message,
  title = 'League invitation',
}: InvitationContextCardProps) {
  return (
    <SectionCard headingLevel={3} padded testId="invitation-context-card" title={title}>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {getLeagueInitials(leagueName)}
        </div>
        <div className="min-w-0">
          <Text as="div" size="base" truncate variant="strong" weight="semibold">{leagueName}</Text>
          {inviteCode ? (
            <Text as="div" className="font-mono uppercase" truncate variant="caption">
              Invite code {inviteCode}
            </Text>
          ) : null}
        </div>
      </div>
      <Text as="p" className="mt-4" variant="meta">{message}</Text>
    </SectionCard>
  );
}
