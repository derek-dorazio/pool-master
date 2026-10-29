import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DateDisplay, ListCard } from '@/features/shared/ui';

/**
 * One contest in a list (#1279), drawn the same way on the contests page, a cup, a championship
 * year and league home: its name, then its date (when it starts, or when it finished once it
 * has), what kind of contest it is and a note, with its status badge on the right and any figure
 * the list adds (entries, cup weight, a squad's place) beside it. The whole row opens `to`.
 *
 * `card` is a list of its own; `compact` is a row in a summary card such as league home's.
 */
export function ContestRow({
  completedAt = null,
  density = 'card',
  details,
  name,
  note,
  startsAt,
  state,
  status,
  testId,
  to,
  trailing,
}: {
  /** When the contest finished; shown in place of its start once set. */
  completedAt?: string | null;
  density?: 'card' | 'compact';
  /** What kind of contest it is, such as its format or sports league, after the date. */
  details?: ReactNode;
  name: string;
  /** A line about the contest for this list: who won it, why it doesn't count, the viewer's entry. */
  note?: ReactNode;
  /** When it starts, or null when it has no event yet. */
  startsAt: string | null;
  /** Router state for the link, such as the league code the contest pages read. */
  state?: unknown;
  /** The contest's status badge. */
  status?: ReactNode;
  testId: string;
  to: string;
  /** The list's own figure, shown beside the status badge. */
  trailing?: ReactNode;
}) {
  const date = completedAt ? (
    <span data-testid={`${testId}-date`}>
      Finished <DateDisplay className="text-muted-foreground" timeStyle={null} value={completedAt} />
    </span>
  ) : startsAt ? (
    <span data-testid={`${testId}-date`}>
      Starts <DateDisplay className="text-muted-foreground" value={startsAt} />
    </span>
  ) : null;
  const facts = date || details ? (
    <span className="flex flex-wrap items-center gap-x-1">
      {date}
      {date && details ? <span aria-hidden="true">·</span> : null}
      {details}
    </span>
  ) : null;
  const side = status || trailing ? (
    <span className="flex flex-none items-center gap-2">
      {trailing ? <span className="font-semibold tabular-nums text-foreground" data-testid={`${testId}-trailing`}>{trailing}</span> : null}
      {status}
    </span>
  ) : null;

  if (density === 'compact') {
    return (
      <Link
        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted"
        data-testid={testId}
        state={state}
        to={to}
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold text-foreground">{name}</span>
          {facts ? <span className="block text-xs text-muted-foreground">{facts}</span> : null}
          {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
        </span>
        {side}
      </Link>
    );
  }

  return (
    <ListCard
      data-testid={testId}
      description={facts}
      metadata={note}
      state={state}
      title={name}
      to={to}
      trailing={side}
    />
  );
}
