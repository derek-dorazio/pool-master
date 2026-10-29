/**
 * #1243 — the table scans `query-plans.ts` lets through, each with why.
 *
 * An entry is either deliberate (a job or a root admin report that reads every row on purpose) or
 * a known miss waiting on its ticket. A fix PR removes its entry; the check fails a scan nothing
 * here names.
 */
import type { GrowingTable } from './query-plans';

export interface SeqScanAllowance {
  table: GrowingTable;
  /** The scan's filter exactly as the failure prints it; null for a read of every row. */
  filter: string | null;
  /** Why the scan is acceptable, or the ticket that adds its index. */
  reason: string;
}

export const SEQ_SCAN_ALLOW_LIST: readonly SeqScanAllowance[] = [
  {
    table: 'leagues',
    filter: null,
    reason: "The root admin's all-leagues list (GET /leagues with scope all, unfiltered) shows every league: "
      + 'a deliberate report, and lists are never paged.',
  },
];
