import { outsideQueryUsage } from './request-query-usage';
import { outsideReadMemo } from './request-read-memo';

/**
 * Runs `work` outside the request that started it: no read memo and no query count. For work a
 * request starts but does not wait for, such as a background sync or the email sender's drain:
 * it may outlive the request, must read afresh, and its queries are not the request's.
 */
export function outsideRequest<T>(work: () => T): T {
  return outsideReadMemo(() => outsideQueryUsage(work));
}
