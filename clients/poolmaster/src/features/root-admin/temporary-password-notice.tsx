import { Notice, Text } from '@/features/shared/ui';

/** The temporary password a reset made, shown in the user dialog until it closes. */
export function TemporaryPasswordNotice({ password, testId }: { password: string; testId: string }) {
  return (
    <Notice data-testid={testId} tone="success">
      <Text as="div" tone="inherit" variant="strong">Temporary password</Text>
      <div className="mt-2 rounded-xl border border-[color:var(--status-active-border)] bg-card px-3 py-2">
        <Text as="span" tone="default" variant="value">{password}</Text>
      </div>
      <Text as="p" className="mt-2" size="xs" tone="inherit">Relay this to the user and have them change it after signing in.</Text>
    </Notice>
  );
}
