import type { SportEventDto } from '@/lib/api';
import { Notice } from '@/features/shared/ui';
import { sportEventHasScoreSync } from './sport-admin-utils';

/**
 * A results panel's warning that the event's scores come from its linked provider (#1497): an
 * admin's edit there is a correction the next sync replaces. Nothing for an event with no link.
 */
export function ScoreSyncNotice({ event, scores, testId }: { event: Pick<SportEventDto, 'syncScope'>; scores: string; testId: string }) {
  if (!sportEventHasScoreSync(event.syncScope)) return null;
  return (
    <Notice data-testid={testId} tone="warning">
      {scores} sync automatically from the linked provider. Manual edits here are corrections and may be overwritten by the next sync tick.
    </Notice>
  );
}
