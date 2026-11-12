import type { ReactNode } from 'react';
import { DateDisplay, SectionRow } from '@/features/shared/ui';

/**
 * One contest in a list (#1279), drawn the same way on the contests page, a cup, a championship
 * year and league home: its name, then its date (when it starts, or when it finished once it
 * has), what kind of contest it is and a note, with its status badge on the right and any figure
 * the list adds (entries, cup weight, a squad's place) beside it. The whole row opens `to`. It is
 * a `SectionRow`, so it sits in a section card's `SectionRows` and looks like every other row.
 * `isHighlighted` marks the contest the viewer came from: it is tinted and scrolled into view.
 */
export function ContestRow({
  completedAt = null,
  details,
  isHighlighted = false,
  name,
  note,
  startsAt,
  status,
  testId,
  to,
  trailing,
}: {
  /** When the contest finished; shown in place of its start once set. */
  completedAt?: string | null;
  /** What kind of contest it is, such as its format or sports league, after the date. */
  details?: ReactNode;
  /** The contest the viewer came from, tinted and scrolled into view. */
  isHighlighted?: boolean;
  name: string;
  /** A line about the contest for this list: who won it, why it doesn't count, the viewer's entry. */
  note?: ReactNode;
  /** When it starts, or null when it has no event yet. */
  startsAt: string | null;
  /** The contest's status badge. */
  status?: ReactNode;
  testId: string;
  to: string;
  /** The list's own figure, shown beside the status badge. */
  trailing?: ReactNode;
}) {
  const date = completedAt ? (
    <span data-testid={`${testId}-date`}>
      Finished <DateDisplay tone="inherit" timeStyle={null} value={completedAt} />
    </span>
  ) : startsAt ? (
    <span data-testid={`${testId}-date`}>
      Starts <DateDisplay tone="inherit" value={startsAt} />
    </span>
  ) : null;
  const facts = date || details ? (
    <span className="flex flex-wrap items-center gap-x-1">
      {date}
      {date && details ? <span aria-hidden="true">·</span> : null}
      {details}
    </span>
  ) : null;

  return (
    <SectionRow
      aside={status}
      facts={facts}
      isHighlighted={isHighlighted}
      name={name}
      note={note}
      testId={testId}
      to={to}
      value={trailing}
      valueTestId={`${testId}-trailing`}
    />
  );
}
