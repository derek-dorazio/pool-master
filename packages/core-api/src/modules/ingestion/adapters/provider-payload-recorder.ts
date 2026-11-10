import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ProviderPayloadCapture,
  ProviderPayloadCaptureSession,
  ProviderPayloadDiagnostics,
} from '../core/provider-interface';

/**
 * #418 — the most response JSON, in characters, one sync run's capture keeps for its ledger
 * row. A response that would take the capture past it is recorded by path and size only. The
 * 2026/2027 tour slates made an unfiltered schedule or ranking sweep about 7.7 MB of detail
 * JSON, and keeping all of it pushed QA's core-api past its 512 MB task limit.
 */
export const providerPayloadCaptureBudgetBytes = 1024 * 1024;

interface ProviderPayloadCaptureBuffer {
  readonly entries: ProviderPayloadCapture[];
  keptBytes: number;
}

/**
 * Keeps the raw responses an adapter reads during one sync run, for the run's diagnostics.
 * Shared by every adapter so the size budget and the session rules are the same for all.
 *
 * Raw payloads are kept only inside a capture session (#418). Calls outside one, such as a
 * catalog browse, keep nothing: nothing drains them, so keeping them grew the heap per call.
 */
export class ProviderPayloadRecorder implements ProviderPayloadDiagnostics {
  private readonly storage = new AsyncLocalStorage<ProviderPayloadCaptureBuffer>();

  /** @param operation the label each capture carries, such as `balldontlie.request`. */
  constructor(private readonly operation: string) {}

  clearProviderPayloads(): void {}

  consumeProviderPayloads(): ProviderPayloadCapture[] {
    return [];
  }

  beginProviderPayloadCapture(): ProviderPayloadCaptureSession {
    const capture: ProviderPayloadCaptureBuffer = { entries: [], keptBytes: 0 };
    return {
      run: async <T>(work: () => Promise<T>): Promise<T> => this.storage.run(capture, work),
      consumeProviderPayloads: (): ProviderPayloadCapture[] => {
        const payloads = [...capture.entries];
        capture.entries.length = 0;
        capture.keptBytes = 0;
        return payloads;
      },
    };
  }

  /** Records one response body read inside a capture session; outside one it does nothing. */
  record(path: string, bytes: number, raw: unknown): void {
    const capture = this.storage.getStore();
    if (!capture) {
      return;
    }

    const entry = { operation: this.operation, path, capturedAt: new Date().toISOString(), bytes };
    if (capture.keptBytes + bytes > providerPayloadCaptureBudgetBytes) {
      capture.entries.push({ ...entry, rawOmitted: true });
      return;
    }

    capture.keptBytes += bytes;
    capture.entries.push({ ...entry, raw });
  }
}
