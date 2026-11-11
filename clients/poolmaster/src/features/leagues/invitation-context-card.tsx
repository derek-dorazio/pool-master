import { getLeagueInitials } from './league-routing';
import { Heading, Text } from '@/features/shared/ui';

type InvitationContextCardProps = {
  leagueName: string;
  inviteCode?: string;
  message: string;
  title?: string;
};

export function InvitationContextCard({
  leagueName,
  inviteCode,
  message,
  title = 'League invitation',
}: InvitationContextCardProps) {
  return (
    <div
      className="rounded-3xl border border-border bg-background p-5"
      data-testid="invitation-context-card"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {getLeagueInitials(leagueName)}
        </div>
        <div className="min-w-0">
          <Heading level={3} variant="eyebrow">{title}</Heading>
          <Text as="div" size="base" truncate variant="strong" weight="semibold">{leagueName}</Text>
          {inviteCode ? (
            <Text as="div" className="font-mono uppercase" truncate variant="caption">
              Invite code {inviteCode}
            </Text>
          ) : null}
        </div>
      </div>
      <Text as="p" className="mt-4" variant="meta">{message}</Text>
    </div>
  );
}
