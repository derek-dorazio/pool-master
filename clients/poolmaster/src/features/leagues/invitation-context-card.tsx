import { getLeagueInitials } from './league-routing';
import { Heading } from '@/features/shared/ui';

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
          <div className="truncate text-base font-semibold text-foreground">{leagueName}</div>
          {inviteCode ? (
            <div className="truncate font-mono text-xs uppercase text-muted-foreground">
              Invite code {inviteCode}
            </div>
          ) : null}
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
