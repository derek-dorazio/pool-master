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

  send(command: CreateInvalidationCommand): Promise<unknown> {
    this.commands.push(command);
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve({});
  }

  paths(): string[][] {
    return this.commands.map((command) => command.input.InvalidationBatch?.Paths?.Items ?? []);
  }
}

function invalidator(client: RecordingCloudFront, logger = fakeLogger()) {
  return new CloudFrontInvalidator({ distributionId: 'E2EXAMPLE', client, logger, batchMs: 5_000, settleMs: 35_000 });
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
