import type { CdnInvalidator } from '../../packages/core-api/src/core/cdn-invalidator';
import type { PublicReadPath } from '../../packages/core-api/src/core/public-cache';

/** Records each `invalidate` call in place of CloudFront, for the tests that check what a save clears (#1181). */
export class RecordingCdnInvalidator implements CdnInvalidator {
  readonly calls: PublicReadPath[][] = [];

  invalidate(paths: readonly PublicReadPath[]): void {
    this.calls.push([...paths]);
  }

  /** Every path asked for since the last `reset`, once each, sorted. */
  paths(): PublicReadPath[] {
    return [...new Set(this.calls.flat())].sort();
  }

  reset(): void {
    this.calls.length = 0;
  }
}
