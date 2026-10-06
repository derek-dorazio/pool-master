import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildApp } from './app';
import type { ContestFeedEventResponse, LiveReplayResponse, LiveScoresSnapshotResponse } from './contracts';
import { ScenarioStore, sandboxGolfScenarioId } from './scenario-store';

/* eslint-disable @typescript-eslint/no-floating-promises --
 * node:test registers top-level tests unawaited; see scenario-store.test.ts for why these
 * are not prefixed with `void`. */

const scenarioDir = resolve(process.cwd(), 'contest-feed-scenarios');
const minuteMs = 60 * 1000;

function storeAt(now: () => Date): ScenarioStore {
  return new ScenarioStore(scenarioDir, undefined, { now });
}

test('any sandbox- event id is answered with a scheduled golf event carrying the shared 80-golfer field', () => {
  const store = storeAt(() => new Date('2026-10-05T09:00:00.000Z'));

  for (const eventId of ['sandbox-derek-golf-tournament', 'sandbox-6f1c2b9e-0d41-4a3c-9a55-1d2f3e4a5b6c']) {
    const event = store.getEvent(sandboxGolfScenarioId, eventId);
    assert.equal(event.eventId, eventId);
    assert.equal(event.status, 'scheduled');
    assert.equal(event.metadata?.externalEventId, eventId);
    assert.equal(store.getSnapshot(sandboxGolfScenarioId, eventId, 'field').contestants.length, 80);
  }
});

test('sandbox events are never listed, and ids without the sandbox- prefix or with nothing after it are not found', () => {
  const store = storeAt(() => new Date('2026-10-05T09:00:00.000Z'));

  assert.equal(store.listEvents(sandboxGolfScenarioId).length, 0);
  assert.ok(store.listScenarios().some((scenario) => scenario.scenarioId === sandboxGolfScenarioId && scenario.sport === 'GOLF'));
  assert.throws(() => store.getEvent(sandboxGolfScenarioId, 'derek-golf-tournament'), /Event not found/);
  assert.throws(() => store.getEvent(sandboxGolfScenarioId, 'sandbox-'), /Event not found/);
  assert.throws(() => store.getEvent('golf-major-2026', 'sandbox-derek-golf-tournament'), /Event not found/);
});

test('a sandbox event reports the same event and pre-live scores whatever today is', () => {
  const monday = storeAt(() => new Date('2026-10-05T09:00:00.000Z'));
  const nextYear = storeAt(() => new Date('2027-06-17T15:00:00.000Z'));
  const eventId = 'sandbox-derek-golf-tournament';

  assert.deepEqual(monday.getEvent(sandboxGolfScenarioId, eventId), nextYear.getEvent(sandboxGolfScenarioId, eventId));
  const scores = monday.getLiveScores(sandboxGolfScenarioId, eventId);
  assert.ok(scores.contestants.every((contestant) => contestant.rounds.length === 0), 'nobody has a round before a replay starts');
});

test('a replay started on a sandbox event makes its scores move between polls', () => {
  const start = Date.parse('2026-10-05T09:00:00.000Z');
  let now = new Date(start);
  const store = storeAt(() => now);
  const eventId = 'sandbox-derek-golf-tournament';

  store.startLiveReplay(sandboxGolfScenarioId, eventId, {});
  now = new Date(start + 7 * minuteMs);
  const first = store.getLiveScores(sandboxGolfScenarioId, eventId);
  now = new Date(start + 13 * minuteMs);
  const second = store.getLiveScores(sandboxGolfScenarioId, eventId);

  assert.ok(first.contestants.length > 0);
  assert.notDeepEqual(first.contestants, second.contestants);
});

test('sandbox routes serve event detail, start a replay and return its moving scores', async () => {
  const previousScenarioDir = process.env.SCENARIO_DIR;
  process.env.SCENARIO_DIR = scenarioDir;
  const app = buildApp();
  const base = `/v1/scenarios/${sandboxGolfScenarioId}/events`;

  try {
    const detail = await app.inject({ method: 'GET', url: `${base}/sandbox-route-check/detail` });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json<ContestFeedEventResponse>().event.eventId, 'sandbox-route-check');

    const replay = await app.inject({
      method: 'PUT',
      url: `${base}/sandbox-route-check/replay`,
      payload: { startsAt: new Date(Date.now() - 10 * minuteMs).toISOString() },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json<LiveReplayResponse>().phase, 'in_progress');

    const scores = await app.inject({ method: 'GET', url: `${base}/sandbox-route-check/scores` });
    assert.equal(scores.statusCode, 200);
    assert.ok(scores.json<LiveScoresSnapshotResponse>().contestants.length > 0);
  } finally {
    await app.close();
    if (previousScenarioDir === undefined) {
      delete process.env.SCENARIO_DIR;
    } else {
      process.env.SCENARIO_DIR = previousScenarioDir;
    }
  }
});
