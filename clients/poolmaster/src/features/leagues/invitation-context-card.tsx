import { getLeagueInitials } from './league-routing';

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
      className="rounded-[1.5rem] border border-border bg-background p-5"
      data-testid="invitation-context-card"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {getLeagueInitials(leagueName)}
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{title}</div>
          <div className="truncate text-base font-semibold text-foreground">{leagueName}</div>
          {inviteCode ? (
            <div className="truncate text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Invite code {inviteCode}
            </div>
          ) : null}
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
