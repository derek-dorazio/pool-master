import { CircleCheck, CircleDashed, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContestEntryStatus } from '@poolmaster/shared/domain';
import { formatDateTimeDisplay, InfoPopover, useDisplayPreferences } from '@/features/shared/ui';
import { CONTEST_ENTRY_STATUS_LABELS } from './contest-status';

const HIDDEN_STATUS_LABEL = 'Hidden until the event starts';

const STATUS_ICONS: Record<ContestEntryStatus, ReactNode> = {
  [ContestEntryStatus.DRAFT]: <CircleDashed aria-hidden className="size-6 [color:var(--status-warning-text)]" />,
  [ContestEntryStatus.SUBMITTED]: <CircleCheck aria-hidden className="size-6 [color:var(--status-active-text)]" />,
};

export type EntryStatusFact = { id: string; label: string; value: ReactNode };

/**
 * An entry page's status, kept beside the entry's name so the page can open on its picks: an
 * icon for submitted or not, and a callout with the status, the contest's phase, any facts the
 * page adds and the entry's dates. `status` is null while another team's entry is hidden.
 */
export function EntryStatusCallout({
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
  const lines: EntryStatusFact[] = [
    { id: 'entry-status', label: 'Entry status', value: statusLabel },
    { id: 'contest-phase', label: 'Contest phase', value: phase },
    ...facts,
    { id: 'created', label: 'Created', value: formatDateTimeDisplay(entry?.createdAt, displayPreferences) },
    { id: 'last-updated', label: 'Last updated', value: formatDateTimeDisplay(entry?.updatedAt, displayPreferences) },
  ];

  return (
    <InfoPopover
      icon={status ? STATUS_ICONS[status] : <EyeOff aria-hidden className="size-6 text-muted-foreground" />}
      label={`Entry status: ${statusLabel}`}
      testId="contest-entry-status"
    >
      <dl className="space-y-2 text-sm">
        {lines.map((fact) => (
          <div className="flex justify-between gap-4" data-testid={`contest-entry-status-${fact.id}`} key={fact.id}>
            <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
            <dd className="text-right font-medium text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </InfoPopover>
  );
}
