import { ContestEntryStatus } from '@poolmaster/shared/domain';
import { CONTEST_ENTRY_STATUS_LABELS } from './contest-status';

/**
 * Where an entry stands, in the one line under its name on a pick screen (#1769): "Not submitted ·
 * submit by Thu 8:15 PM" or "Submitted · change until Thu 8:15 PM" while it can change, and its
 * status once it cannot. `closes` is when picks close, as the page words it.
 */
export function entryStatusLine({
  closes,
  isOpen,
  status,
}: {
  closes: string;
  /** The entry's own, and its picks can still change. */
  isOpen: boolean;
  /** Null while another team's entry is hidden. */
  status: ContestEntryStatus | null;
}): string {
  if (status === null) {
    return 'Hidden until the event starts';
  }
  if (!isOpen) {
    return CONTEST_ENTRY_STATUS_LABELS[status];
  }
  return status === ContestEntryStatus.SUBMITTED ? `Submitted · change until ${closes}` : `Not submitted · submit by ${closes}`;
}

/**
 * The Name and submit card's status beside its button (#1769): that the entry is submitted, else
 * what still blocks Submit, else when to submit by.
 */
export function entryFinishStatus({ closes, hint, isSubmitted }: { closes: string; hint: string | null; isSubmitted: boolean }): string {
  if (isSubmitted) {
    return `✓ Submitted · change until ${closes}`;
  }
  return hint ?? `Submit by ${closes}`;
}
