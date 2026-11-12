import { Text } from '@/features/shared/ui';

/** The small print closing a landing page: whom it is not affiliated with. */
export function LandingDisclaimer({ children, testId }: { children: string; testId: string }) {
  return <Text as="p" data-testid={testId} variant="caption">{children}</Text>;
}
