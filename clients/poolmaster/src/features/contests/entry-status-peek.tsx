import { CircleCheck, CircleDashed, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContestEntryStatus } from '@poolmaster/shared/domain';
import { DetailsPeek, formatDateTimeDisplay, Icon, PeekCard, useDisplayPreferences, type PeekFact } from '@/features/shared/ui';
import { CONTEST_ENTRY_STATUS_LABELS } from './contest-status';

const HIDDEN_STATUS_LABEL = 'Hidden until the event starts';

const STATUS_ICONS: Record<ContestEntryStatus, ReactNode> = {
  [ContestEntryStatus.DRAFT]: <CircleDashed aria-hidden className="size-6 [color:var(--status-warning-text)]" />,
  [ContestEntryStatus.SUBMITTED]: <CircleCheck aria-hidden className="size-6 [color:var(--status-active-text)]" />,
};

export type EntryStatusFact = { id: string; label: string; value: ReactNode };

const STATUS_TEST_ID = 'contest-entry-status';

/**
 * An entry page's status, kept beside the entry's name so the page can open on its picks: the
 * Details pattern (`rules/ux-rules.md` §15 *Showing More*) with the entry's status glyph in place
 * of the (i). Its peek card leads with the status and the contest's phase, then any facts the
 * page adds and the entry's dates. `status` is null while another team's entry is hidden.
 */
export function EntryStatusPeek({
  entry,
  facts = [],
  phase,
  status,
}: {
  /** The entry's own read, for when it was created and last changed; null until it loads. */
  entry: { createdAt?: string | null; updatedAt?: string | null } | null;
  /** The page's own lines, after the contest's phase. */
  facts?: EntryStatusFact[];
  /** The contest's phase as the page words it. */
  phase: string;
  status: ContestEntryStatus | null;
}) {
  const displayPreferences = useDisplayPreferences();
  const statusLabel = status ? CONTEST_ENTRY_STATUS_LABELS[status] : HIDDEN_STATUS_LABEL;
  // The card leads with the status and the contest's phase; the entry's name is right above it.
  // Short labels keep each date on one line on a phone.
  const lines: EntryStatusFact[] = [
    ...facts,
    { id: 'created', label: 'Created', value: formatDateTimeDisplay(entry?.createdAt, displayPreferences) },
    { id: 'last-updated', label: 'Updated', value: formatDateTimeDisplay(entry?.updatedAt, displayPreferences) },
  ];
  const peekFacts: PeekFact[] = lines.map((line) => ({ label: line.label, testId: `${STATUS_TEST_ID}-${line.id}`, value: line.value }));

  return (
    <DetailsPeek
      icon={status ? STATUS_ICONS[status] : <Icon icon={EyeOff} size={24} tone="muted" />}
      label={`Entry status: ${statusLabel}`}
      testId={STATUS_TEST_ID}
    >
      <PeekCard
        facts={peekFacts}
        subtitle={<span data-testid={`${STATUS_TEST_ID}-contest-phase`}>{phase}</span>}
        title={<span data-testid={`${STATUS_TEST_ID}-entry-status`}>{statusLabel}</span>}
      />
    </DetailsPeek>
  );
}
