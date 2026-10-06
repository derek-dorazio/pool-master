import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildApp } from './app';
import type { ContestantRecord, LiveGolfContestantRecord, LiveReplayResponse, LiveScoresSnapshotResponse } from './contracts';
import { simulateGolfLiveScores, type GolfLiveTimeline } from './golf-live-simulation';
import { ScenarioStore } from './scenario-store';

/* eslint-disable @typescript-eslint/no-floating-promises --
 * node:test registers top-level tests unawaited; see scenario-store.test.ts for why these
 * are not prefixed with `void`. */

const scenarioDir = resolve(process.cwd(), 'contest-feed-scenarios');
const scenarioId = 'golf-major-2026';
const eventId = 'golf-players-2026';
const replayStart = Date.parse('2026-10-06T12:00:00.000Z');
const minutes = (count: number) => new Date(replayStart + count * 60 * 1000);

const timeline: GolfLiveTimeline = { startsAt: minutes(0), minutesPerRound: 20, minutesBetweenRounds: 0 };

const field: readonly ContestantRecord[] = Array.from({ length: 120 }, (_, index) => ({
  contestantId: `golfer-${index + 1}`,
  name: `Golfer ${String(index + 1).padStart(3, '0')}`,
  seed: index + 1,
}));

function simulateAt(minute: number): readonly LiveGolfContestantRecord[] {
  return simulateGolfLiveScores({ eventSeed: 'test-event', contestants: field, timeline, now: minutes(minute) });
}

function total(contestant: LiveGolfContestantRecord, throughRound = 4): number {
  return contestant.rounds.filter((round) => round.round <= throughRound).reduce((sum, round) => sum + round.scoreToPar, 0);
}

function storeAt(now: () => Date): ScenarioStore {
  return new ScenarioStore(scenarioDir, undefined, { now });
}

test('live simulation shows nobody before the replay starts', () => {
  assert.equal(simulateGolfLiveScores({ eventSeed: 'test-event', contestants: field, timeline, now: minutes(-5) }).length, 0);
});

test('live simulation advances holes and scores between two polls in the same round', () => {
  const early = new Map(simulateAt(8).map((contestant) => [contestant.contestantId, contestant.rounds[0]]));
  const later = simulateAt(14);

  assert.ok(later.length >= early.size);
  const advanced = later.filter((contestant) => (contestant.rounds[0].thru ?? 0) > (early.get(contestant.contestantId)?.thru ?? 0));
  assert.ok(advanced.length > field.length / 2, 'most of the field plays more holes between the two polls');
  assert.ok(
    later.some((contestant) => contestant.rounds[0].scoreToPar !== early.get(contestant.contestantId)?.scoreToPar),
    'some to-par values change between the two polls',
  );
});

test('live simulation never reports a round 5 or a hole past 18, and finishes with four completed rounds', () => {
  for (const minute of [5, 19, 33, 47, 61, 79, 80, 500]) {
    for (const contestant of simulateAt(minute)) {
      for (const round of contestant.rounds) {
        assert.ok(round.round >= 1 && round.round <= 4, `round ${round.round} at minute ${minute}`);
        assert.ok((round.thru ?? 0) <= 18, `thru ${round.thru} at minute ${minute}`);
      }
    }
  }

  const final = simulateAt(80);
  const finishers = final.filter((contestant) => contestant.rounds.length === 4 && contestant.rounds.every((round) => round.status === 'COMPLETED'));
  assert.ok(finishers.length >= 60);
  assert.ok(final.every((contestant) => contestant.rounds.every((round) => round.status !== 'IN_PROGRESS')));
});

test('live simulation cuts everyone outside the top 65 and ties after round 2', () => {
  const afterCut = simulateAt(40);
  const madeCut = afterCut.filter((contestant) => contestant.rounds.length >= 2 && contestant.rounds[1].status === 'COMPLETED');
  const missedCut = afterCut.filter((contestant) => contestant.rounds[1]?.status === 'MISSED_CUT');

  assert.ok(madeCut.length >= 65, `${madeCut.length} made the cut`);
  assert.ok(missedCut.length > 0);
  const cutLine = Math.max(...madeCut.map((contestant) => total(contestant, 2)));
  assert.ok(missedCut.every((contestant) => total(contestant, 2) > cutLine));
  assert.ok(missedCut.every((contestant) => contestant.participantStatus === 'cut' && contestant.rounds.length === 2));
});

test('live simulation lets better-ranked golfers score better on average', () => {
  const firstRound = simulateAt(20);
  const average = (from: number, to: number) => {
    const group = firstRound.filter((contestant) => (contestant.seed ?? 0) >= from && (contestant.seed ?? 0) <= to);
    return group.reduce((sum, contestant) => sum + contestant.rounds[0].scoreToPar, 0) / group.length;
  };

  assert.ok(average(1, 30) < average(91, 120));
});

test('live simulation gives the same scores for the same event, field and moment', () => {
  assert.deepEqual(simulateAt(37), simulateAt(37));
});

test('a running replay makes /scores without a state token move between polls', () => {
  let now = minutes(0);
  const store = storeAt(() => now);
  store.startLiveReplay(scenarioId, eventId, {});

  now = minutes(6);
  const first = store.getLiveScores(scenarioId, eventId);
  now = minutes(12);
  const second = store.getLiveScores(scenarioId, eventId);

  assert.ok(first.contestants.length > 0);
  assert.notDeepEqual(first.contestants, second.contestants);
  assert.equal(second.asOf, minutes(12).toISOString());
});

test('a mockEventState token still pins the fixed state while a replay is running', () => {
  let now = minutes(0);
  const store = storeAt(() => now);
  const pinnedBefore = store.getLiveScores(scenarioId, eventId, undefined, 'golf-r2-complete');
  store.startLiveReplay(scenarioId, eventId, {});
  now = minutes(7);

  assert.deepEqual(store.getLiveScores(scenarioId, eventId, undefined, 'golf-r2-complete').contestants, pinnedBefore.contestants);
});

test('stopping a replay returns /scores to its previous fixed behaviour', () => {
  let now = minutes(0);
  const store = storeAt(() => now);
  const beforeReplay = store.getLiveScores(scenarioId, eventId, 1);
  store.startLiveReplay(scenarioId, eventId, {});
  now = minutes(30);
  store.stopLiveReplay(scenarioId, eventId);

  assert.deepEqual(store.getLiveScores(scenarioId, eventId, 1).contestants, beforeReplay.contestants);
  assert.throws(() => store.getLiveReplay(scenarioId, eventId), /No live replay is running/);
});

test('a replay can only be started for a golf scenario', () => {
  const store = storeAt(() => minutes(0));
  const tennis = store.listScenarios().find((scenario) => scenario.sport === 'TENNIS');
  assert.ok(tennis);
  const tennisEvent = store.listEvents(tennis.scenarioId)[0];

  assert.throws(() => store.startLiveReplay(tennis.scenarioId, tennisEvent.eventId, {}), /only supported for GOLF/);
});

test('replay routes start, report and stop a replay, /scores follows it, a non-golf replay is refused with 409, and a stopped replay reports 404', async () => {
  const previousScenarioDir = process.env.SCENARIO_DIR;
  process.env.SCENARIO_DIR = scenarioDir;
  const app = buildApp();
  const replayUrl = `/v1/scenarios/${scenarioId}/events/${eventId}/replay`;

  try {
    const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const started = await app.inject({ method: 'PUT', url: replayUrl, payload: { startsAt: startedAt, minutesPerRound: 30 } });
    assert.equal(started.statusCode, 200);
    const replay = started.json<LiveReplayResponse>();
    assert.equal(replay.minutesPerRound, 30);
    assert.equal(replay.phase, 'in_progress');
    assert.equal(replay.currentRound, 1);
    assert.equal(replay.endsAt, new Date(Date.parse(startedAt) + 120 * 60 * 1000).toISOString());

    const reported = await app.inject({ method: 'GET', url: replayUrl });
    assert.equal(reported.statusCode, 200);
    assert.equal(reported.json<LiveReplayResponse>().startsAt, startedAt);

    const scores = await app.inject({ method: 'GET', url: `/v1/scenarios/${scenarioId}/events/${eventId}/scores` });
    assert.equal(scores.statusCode, 200);
    const payload = scores.json<LiveScoresSnapshotResponse>();
    assert.match(payload.note ?? '', /^Live replay in_progress round 1/);
    assert.ok(payload.contestants.every((contestant) => contestant.rounds.length === 1));

    const invalid = await app.inject({ method: 'PUT', url: replayUrl, payload: { minutesPerRound: 0 } });
    assert.equal(invalid.statusCode, 400);

    const tennis = await app.inject({ method: 'GET', url: '/v1/scenarios' });
    const tennisScenario = tennis.json<{ scenarios: Array<{ scenarioId: string; sport: string }> }>().scenarios
      .find((scenario) => scenario.sport === 'TENNIS');
    assert.ok(tennisScenario);
    const tennisEvents = await app.inject({ method: 'GET', url: `/v1/scenarios/${tennisScenario.scenarioId}/events` });
    const tennisEventId = tennisEvents.json<{ events: Array<{ eventId: string }> }>().events[0].eventId;
    const nonGolf = await app.inject({
      method: 'PUT',
      url: `/v1/scenarios/${tennisScenario.scenarioId}/events/${tennisEventId}/replay`,
      payload: {},
    });
    assert.equal(nonGolf.statusCode, 409);

    const stopped = await app.inject({ method: 'DELETE', url: replayUrl });
    assert.equal(stopped.statusCode, 204);
    const afterStop = await app.inject({ method: 'GET', url: replayUrl });
    assert.equal(afterStop.statusCode, 404);
  } finally {
    await app.close();
    if (previousScenarioDir === undefined) {
      delete process.env.SCENARIO_DIR;
    } else {
      process.env.SCENARIO_DIR = previousScenarioDir;
    }
  }
});
