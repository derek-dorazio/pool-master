import type { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import {
  CloudFrontInvalidator,
  NoCdnInvalidator,
  createCdnInvalidator,
  type CloudFrontClientLike,
} from '../../../packages/core-api/src/core/cdn-invalidator';
import { PublicReadPath } from '../../../packages/core-api/src/core/public-cache';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';

// #1181 — what an admin save asks CloudFront to clear, and when. The AWS client is a stand-in
// that records each CreateInvalidation it is sent.

class RecordingCloudFront implements CloudFrontClientLike {
  readonly commands: CreateInvalidationCommand[] = [];
  failWith: Error | null = null;
  /** Errors to answer the next sends with, one each, before succeeding (or `failWith`). */
  readonly failNext: Error[] = [];

  send(command: CreateInvalidationCommand): Promise<unknown> {
    this.commands.push(command);
    const error = this.failNext.shift() ?? this.failWith;
    return error ? Promise.reject(error) : Promise.resolve({});
  }

  paths(): string[][] {
    return this.commands.map((command) => command.input.InvalidationBatch?.Paths?.Items ?? []);
  }
}

function invalidator(client: RecordingCloudFront, logger = fakeLogger()) {
  return new CloudFrontInvalidator({ distributionId: 'E2EXAMPLE', client, logger, batchMs: 5_000, maxWaitMs: 60_000, retryMs: 60_000, settleMs: 35_000 });
}

function tooManyInProgress(): Error {
  return Object.assign(new Error('Your request contains too many invalidations.'), { name: 'TooManyInvalidationsInProgress' });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('CloudFrontInvalidator', () => {
  it('sends the saves made within 5 seconds as one invalidation of every path they asked for', async () => {
    const client = new RecordingCloudFront();
    const cdn = invalidator(client);

    cdn.invalidate([PublicReadPath.SPORT_LEAGUES, PublicReadPath.EVENT_PAGES]);
    cdn.invalidate([PublicReadPath.EVENT_PAGES]);
    cdn.invalidate([PublicReadPath.PLANS]);
    expect(client.commands).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(client.paths()).toEqual([[PublicReadPath.EVENT_PAGES, PublicReadPath.PLANS, PublicReadPath.SPORT_LEAGUES]]);
    const batch = expectDefined(client.commands[0], 'the invalidation').input;
    expect(batch.DistributionId).toBe('E2EXAMPLE');
    expect(batch.InvalidationBatch?.Paths?.Quantity).toBe(3);
  });

  it('sends the same paths again 35 seconds later, once every task has caught up with the save', async () => {
    const client = new RecordingCloudFront();
    const cdn = invalidator(client);

    cdn.invalidate([PublicReadPath.PLANS]);
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(34_999);
    expect(client.commands).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);

    expect(client.paths()).toEqual([[PublicReadPath.PLANS], [PublicReadPath.PLANS]]);
    const [first, second] = client.commands.map((command) => command.input.InvalidationBatch?.CallerReference);
    expect(first).not.toBe(second);
  });

  it('starts a new batch for a save after the last one was sent, and does not resend without one', async () => {
    const client = new RecordingCloudFront();
    const cdn = invalidator(client);

    cdn.invalidate([PublicReadPath.PLANS]);
    await jest.advanceTimersByTimeAsync(40_000);
    cdn.invalidate([PublicReadPath.CONTEST_CONFIG_TEMPLATES]);
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(600_000);

    expect(client.paths()).toEqual([
      [PublicReadPath.PLANS],
      [PublicReadPath.PLANS],
      [PublicReadPath.CONTEST_CONFIG_TEMPLATES],
      [PublicReadPath.CONTEST_CONFIG_TEMPLATES],
    ]);
  });

  it('waits for 5 seconds with no further save, so a data load writing every few seconds sends one invalidation, not one per batch', async () => {
    const client = new RecordingCloudFront();
    const cdn = invalidator(client);

    for (let save = 0; save < 5; save += 1) {
      cdn.invalidate([PublicReadPath.EVENT_PAGES]);
      await jest.advanceTimersByTimeAsync(4_000);
    }
    expect(client.commands).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(client.paths()).toEqual([[PublicReadPath.EVENT_PAGES]]);
  });

  it('sends at most 60 seconds after the first save while saves keep arriving', async () => {
    const client = new RecordingCloudFront();
    const cdn = invalidator(client);

    for (let second = 0; second < 59; second += 1) {
      cdn.invalidate([PublicReadPath.EVENT_PAGES]);
      await jest.advanceTimersByTimeAsync(1_000);
    }
    expect(client.commands).toHaveLength(0);
    cdn.invalidate([PublicReadPath.SPORT_LEAGUES]);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(client.paths()).toEqual([[PublicReadPath.EVENT_PAGES, PublicReadPath.SPORT_LEAGUES]]);
  });

  it('sends an invalidation CloudFront refused for too many in progress once more, a minute later, rather than dropping it', async () => {
    const client = new RecordingCloudFront();
    client.failNext.push(tooManyInProgress());
    const logger = fakeLogger();
    const cdn = invalidator(client, logger);

    cdn.invalidate([PublicReadPath.EVENT_PAGES]);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(client.commands).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(client.commands).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(30_000);

    // First try refused, the settled send at 35 s, then the retry at 60 s.
    expect(client.paths()).toEqual([[PublicReadPath.EVENT_PAGES], [PublicReadPath.EVENT_PAGES], [PublicReadPath.EVENT_PAGES]]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an invalidation refused for too many in progress twice as an error, and tries no more', async () => {
    const client = new RecordingCloudFront();
    client.failWith = tooManyInProgress();
    const logger = fakeLogger();
    const cdn = invalidator(client, logger);

    cdn.invalidate([PublicReadPath.PLANS]);
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(60_000);
    await jest.advanceTimersByTimeAsync(600_000);

    // The first send, the settled one, and one retry of each: four, and no fifth.
    expect(client.commands).toHaveLength(4);
    expect(logger.error.mock.calls.map(([entry]) => (entry as { data: { round: string } }).data.round).sort()).toEqual(['first', 'settled']);
  });

  it('sends nothing for a save that changed no public read', async () => {
    const client = new RecordingCloudFront();

    invalidator(client).invalidate([]);
    await jest.advanceTimersByTimeAsync(600_000);

    expect(client.commands).toHaveLength(0);
  });

  it('logs a failed invalidation as an error with its paths rather than failing the save', async () => {
    const client = new RecordingCloudFront();
    client.failWith = new Error('AccessDenied');
    const logger = fakeLogger();
    const cdn = invalidator(client, logger);

    expect(() => cdn.invalidate([PublicReadPath.SPORT_LEAGUES])).not.toThrow();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(logger.error).toHaveBeenCalledWith(
      { action: 'cdn.invalidate.failed', data: { paths: [PublicReadPath.SPORT_LEAGUES], round: 'first', error: 'AccessDenied' } },
      expect.any(String),
    );
  });
});

describe('createCdnInvalidator', () => {
  it('invalidates no CDN when CLOUDFRONT_DISTRIBUTION_ID is unset or blank, as on a local run', () => {
    expect(createCdnInvalidator({}, fakeLogger())).toBeInstanceOf(NoCdnInvalidator);
    expect(createCdnInvalidator({ CLOUDFRONT_DISTRIBUTION_ID: ' ' }, fakeLogger())).toBeInstanceOf(NoCdnInvalidator);
  });

  it('invalidates CloudFront when CLOUDFRONT_DISTRIBUTION_ID names the distribution', () => {
    expect(createCdnInvalidator({ CLOUDFRONT_DISTRIBUTION_ID: 'E2EXAMPLE' }, fakeLogger())).toBeInstanceOf(CloudFrontInvalidator);
  });
});
