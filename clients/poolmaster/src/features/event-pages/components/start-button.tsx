import { LinkButton } from '@/features/shared/ui';
import { buildStartPath, type StartRequest } from '../start-path';

/** Every start button on an event page goes the same way (#1008): `/start` decides where the visitor belongs. */
export function StartButton({ children, request, size, testId, variant = 'primary' }: {
  children: string;
  request: StartRequest;
  size?: 'sm' | 'lg';
  testId: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return <LinkButton data-testid={testId} size={size} to={buildStartPath(request)} variant={variant}>{children}</LinkButton>;
}
