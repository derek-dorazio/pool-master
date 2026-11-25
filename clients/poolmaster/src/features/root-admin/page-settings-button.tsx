import { Settings } from 'lucide-react';
import { Button } from '@/features/shared/ui';

/** The gear on a root-admin page's header that opens its settings dialog: a league's or an event's. */
export function PageSettingsButton({ name, onClick, testId }: { name: string; onClick: () => void; testId: string }) {
  return (
    <Button aria-label={`${name} settings`} data-testid={testId} onClick={onClick} size="sm" variant="icon">
      <Settings aria-hidden size={16} />
    </Button>
  );
}
