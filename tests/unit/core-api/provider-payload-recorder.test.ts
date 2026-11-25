import {
  ProviderPayloadRecorder,
  providerPayloadCaptureBudgetBytes,
} from '../../../packages/core-api/src/modules/ingestion/adapters/provider-payload-recorder';

describe('ProviderPayloadRecorder', () => {
  it('keeps nothing for a response read outside a capture session', () => {
    const recorder = new ProviderPayloadRecorder('feed.request');
    const session = recorder.beginProviderPayloadCapture();

    recorder.record('/games', 10, { games: [] });

    expect(session.consumeProviderPayloads()).toEqual([]);
    expect(recorder.consumeProviderPayloads()).toEqual([]);
  });

  it('keeps each body read inside a session, then records a body past the size budget by path and size only', async () => {
    const recorder = new ProviderPayloadRecorder('feed.request');
    const session = recorder.beginProviderPayloadCapture();

    await session.run(() => {
      recorder.record('/small', 10, { ok: true });
      recorder.record('/huge', providerPayloadCaptureBudgetBytes, { too: 'big' });
      return Promise.resolve();
    });

    const [small, huge] = session.consumeProviderPayloads();
    expect(small).toMatchObject({ operation: 'feed.request', path: '/small', bytes: 10, raw: { ok: true } });
    expect(huge).toMatchObject({ path: '/huge', bytes: providerPayloadCaptureBudgetBytes, rawOmitted: true });
    expect(huge).not.toHaveProperty('raw');
    expect(session.consumeProviderPayloads()).toEqual([]);
  });
});
