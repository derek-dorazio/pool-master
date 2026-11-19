import { Notice } from '@/features/shared/ui';

/** The temporary password a reset made, shown in the user dialog until it closes. */
export function TemporaryPasswordNotice({ password, testId }: { password: string; testId: string }) {
  return (
    <Notice data-testid={testId} tone="success">
      <div className="font-semibold">Temporary password</div>
      <div className="mt-2 rounded-xl border border-[color:var(--status-active-border)] bg-card px-3 py-2 font-mono text-foreground">
        {password}
      </div>
      <p className="mt-2 text-xs">Relay this to the user and have them change it after signing in.</p>
    </Notice>
  );
}
