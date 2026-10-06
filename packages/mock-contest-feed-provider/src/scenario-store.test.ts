import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildApp } from './app';
import { ScenarioStore } from './scenario-store';
import type {
  ContestFeedEventResponse,
  ContestFeedSnapshotResponse,
  LiveScoresSnapshotResponse,
} from './contracts';

/* eslint-disable @typescript-eslint/no-floating-promises --
 * node:test's test() returns a Promise, but registering each top-level test
 * unawaited is the standard node:test pattern -- the runner tracks and awaits
 * them itself. Prefixing every call with `void` here reproduces a real,
 * reproducible failure ("Promise resolution is still pending but the event
 * loop has already resolved") in the tests that spin up a real Fastify app
 * (verified by toggling void on/off against a clean checkout twice each way);
 * root cause not isolated further. Suppressing is the safe choice over
 * changing a working test file's call shape for a cosmetic lint fix. */

const scenarioDir = resolve(process.cwd(), 'contest-feed-scenarios');

test('ScenarioStore loads event-first scenarios and exposes field snapshots', () => {
  const store = new ScenarioStore(scenarioDir);

  const scenarios = store.listScenarios();
  assert.ok(scenarios.some((scenario) => scenario.scenarioId === 'golf-major-2026'));

  const golfScenario = store.getScenario('golf-major-2026');
  assert.equal(golfScenario.season.year, 2026);
  assert.equal(golfScenario.events[0]?.field.status, 'locked');

  const fieldSnapshot = store.getSnapshot('golf-major-2026', 'golf-masters-2026', 'field');
  assert.equal(fieldSnapshot.feedKind, 'field');
  assert.equal(fieldSnapshot.contestants[0]?.name, 'Scottie Scheffler');
  assert.equal(fieldSnapshot.contestants.length, 80);

  const resultUpdates = store.getUpdates('golf-major-2026', 'golf-masters-2026');
  assert.equal(resultUpdates.updates[0]?.feedKind, 'field');
  assert.equal(resultUpdates.updates[1]?.feedKind, 'odds');
  assert.equal(resultUpdates.updates[2]?.feedKind, 'results');
});

test('ScenarioStore catalog is golf-only and does not change with the clock: no scenario is generated from the current date', () => {
  let currentNow = new Date('2026-04-26T21:00:00.000Z');
  const store = new ScenarioStore(scenarioDir, undefined, { now: () => currentNow });

  const before = store.listScenarios();
  assert.ok(before.every((scenario) => scenario.sport === 'GOLF'));
  assert.ok(before.some((scenario) => scenario.scenarioId === 'golf-sandbox'));
  assert.ok(before.every((scenario) => scenario.scenarioId !== 'golf-relative-today'));

  currentNow = new Date('2027-09-01T12:00:00.000Z');
  assert.deepEqual(store.listScenarios(), before);
});

test('pool-master-33l.8.8: explicit mock event states control golf detail, results, and live scores', () => {
  const store = new ScenarioStore(scenarioDir);
  const scenarioId = 'golf-major-2026';
  const eventId = 'golf-masters-2026';

  const openDetail = store.getEventResponse(scenarioId, eventId, 'open');
  assert.equal(openDetail.event.status, 'field_announced');
  assert.equal(openDetail.event.field.status, 'announced');
  assert.equal(store.getLiveScores(scenarioId, eventId, undefined, 'open').contestants.length, 0);

  const lockedDetail = store.getEventResponse(scenarioId, eventId, 'locked');
  assert.equal(lockedDetail.event.status, 'field_announced');
  assert.equal(lockedDetail.event.field.status, 'locked');
  assert.equal(store.getLiveScores(scenarioId, eventId, undefined, 'locked').contestants.length, 0);

  const liveDetail = store.getEventResponse(scenarioId, eventId, 'live');
  assert.equal(liveDetail.event.status, 'in_progress');
  assert.equal(liveDetail.event.field.status, 'locked');
  const liveScores = store.getLiveScores(scenarioId, eventId, 2, 'live');
  assert.equal(liveScores.contestants.length, 80);
  assert.equal(liveScores.contestants[0]?.rounds.length, 1);
  assert.equal(liveScores.contestants[0]?.rounds[0]?.status, 'IN_PROGRESS');
  assert.ok(typeof liveScores.contestants[0]?.rounds[0]?.strokes === 'number');

  const completedDetail = store.getEventResponse(scenarioId, eventId, 'completed');
  assert.equal(completedDetail.event.status, 'completed');
  assert.equal(completedDetail.event.field.status, 'final');
  const completedResults = store.getSnapshot(scenarioId, eventId, 'results', 'completed');
  assert.equal(completedResults.contestants.length, 80);
  assert.ok(completedResults.contestants.some((contestant) => contestant.result === 'win'));
  assert.ok(completedResults.contestants.every((contestant) => typeof contestant.strokes === 'number'));
});

test('pool-master-eux.7: golf mock live-state tokens emit provider-owned multi-round /scores payloads', () => {
  const store = new ScenarioStore(scenarioDir);
  const scenarioId = 'golf-major-2026';
  const eventId = 'golf-masters-2026';

  const preLive = store.getLiveScores(scenarioId, eventId, undefined, 'golf-pre-live');
  assert.equal(preLive.contestants.length, 0);

  const r1InProgress = store.getLiveScores(scenarioId, eventId, undefined, 'golf-r1-in-progress');
  assert.equal(r1InProgress.contestants.length, 80);
  assert.equal(r1InProgress.contestants[0]?.rounds.length, 1);
  assert.equal(r1InProgress.contestants[0]?.rounds[0]?.status, 'IN_PROGRESS');
  assert.ok((r1InProgress.contestants[0]?.rounds[0]?.thru ?? 18) < 18);
  assert.equal(r1InProgress.contestants[0]?.rounds[0]?.completedAt, undefined);

  const r1Complete = store.getLiveScores(scenarioId, eventId, undefined, 'golf-r1-complete');
  assert.equal(r1Complete.contestants[0]?.rounds[0]?.status, 'COMPLETED');
  assert.equal(r1Complete.contestants[0]?.rounds[0]?.thru, 18);
  assert.ok(typeof r1Complete.contestants[0]?.rounds[0]?.completedAt === 'string');

  const r2Complete = store.getLiveScores(scenarioId, eventId, undefined, 'golf-r2-complete');
  assert.ok(r2Complete.contestants.some((contestant) =>
    contestant.participantStatus === 'cut'
    && contestant.rounds.at(-1)?.status === 'MISSED_CUT',
  ));

  const corrected = store.getLiveScores(scenarioId, eventId, undefined, 'golf-correction');
  const r2Golfer01 = r2Complete.contestants.find((contestant) => contestant.contestantId === 'golfer-01');
  const correctedGolfer01 = corrected.contestants.find((contestant) => contestant.contestantId === 'golfer-01');
  assert.equal(
    correctedGolfer01?.rounds.find((round) => round.round === 2)?.scoreToPar,
    (r2Golfer01?.rounds.find((round) => round.round === 2)?.scoreToPar ?? 0) - 2,
  );

  const r4PendingFinal = store.getLiveScores(scenarioId, eventId, undefined, 'golf-r4-complete-pending-final');
  assert.equal(store.getEventResponse(scenarioId, eventId, 'golf-r4-complete-pending-final').event.status, 'in_progress');
  assert.ok(r4PendingFinal.contestants.some((contestant) => contestant.rounds.length === 4));
  assert.ok(r4PendingFinal.contestants.some((contestant) => contestant.rounds.at(-1)?.status === 'DNF'));
  assert.ok(r4PendingFinal.contestants.some((contestant) => contestant.rounds.at(-1)?.status === 'DSQ'));

  const playoff = store.getLiveScores(scenarioId, eventId, undefined, 'golf-playoff');
  assert.equal(store.getEventResponse(scenarioId, eventId, 'golf-playoff').event.status, 'in_progress');
  assert.ok(playoff.contestants.every((contestant) => contestant.rounds.every((round) => round.status !== 'IN_PROGRESS')));

  const completed = store.getLiveScores(scenarioId, eventId, undefined, 'golf-completed');
  assert.equal(store.getEventResponse(scenarioId, eventId, 'golf-completed').event.status, 'completed');
  assert.ok(completed.contestants.every((contestant) => contestant.rounds.every((round) => round.status !== 'IN_PROGRESS')));

  const lateCorrection = store.getLiveScores(scenarioId, eventId, undefined, 'golf-late-correction');
  const completedGolfer01 = completed.contestants.find((contestant) => contestant.contestantId === 'golfer-01');
  const lateGolfer01 = lateCorrection.contestants.find((contestant) => contestant.contestantId === 'golfer-01');
  assert.equal(
    lateGolfer01?.rounds.find((round) => round.round === 4)?.scoreToPar,
    (completedGolfer01?.rounds.find((round) => round.round === 4)?.scoreToPar ?? 0) - 2,
  );
});

test('golf playoffs are never a round 5: every golf state stops at round 4 with 18-hole rounds, and the playoff states end with the top two genuinely tied', () => {
  const store = new ScenarioStore(scenarioDir);
  const scenarioId = 'golf-major-2026';
  const eventId = 'golf-masters-2026';
  const total = (contestant: LiveScoresSnapshotResponse['contestants'][number]) =>
    contestant.rounds.reduce((sum, round) => sum + round.scoreToPar, 0);

  for (const token of [
    'golf-r1-in-progress',
    'golf-r1-complete',
    'golf-r2-complete',
    'golf-correction',
    'golf-r4-complete-pending-final',
    'golf-playoff',
    'golf-completed',
    'golf-late-correction',
  ] as const) {
    const snapshot = store.getLiveScores(scenarioId, eventId, undefined, token);
    for (const contestant of snapshot.contestants) {
      for (const round of contestant.rounds) {
        assert.ok(round.round <= 4, `${token}: ${contestant.contestantId} has round ${round.round}`);
        assert.ok((round.thru ?? 0) <= 18, `${token}: ${contestant.contestantId} round ${round.round} thru ${round.thru}`);
      }
    }
  }

  for (const token of ['golf-playoff', 'golf-completed'] as const) {
    const [leader, runnerUp] = store.getLiveScores(scenarioId, eventId, undefined, token).contestants;
    assert.equal(leader.rounds.length, 4);
    assert.equal(runnerUp.rounds.length, 4);
    assert.equal(total(runnerUp), total(leader), `${token}: the top two are tied after 72 holes`);
    const runnerUpRound4 = runnerUp.rounds.find((round) => round.round === 4);
    assert.equal(runnerUpRound4?.strokes, 72 + (runnerUpRound4?.scoreToPar ?? Number.NaN));
  }
});

test('pool-master-eux.7: legacy mock event states are aliases into the live /scores shape', () => {
  const store = new ScenarioStore(scenarioDir);
  const scenarioId = 'golf-major-2026';
  const eventId = 'golf-masters-2026';

  assert.equal(store.getLiveScores(scenarioId, eventId, undefined, 'open').contestants.length, 0);
  assert.equal(store.getLiveScores(scenarioId, eventId, undefined, 'locked').contestants.length, 0);

  const live = store.getLiveScores(scenarioId, eventId, undefined, 'live');
  assert.equal(live.contestants[0]?.rounds[0]?.status, 'IN_PROGRESS');
  assert.equal('score' in (live.contestants[0] ?? {}), false);
  assert.equal('strokes' in (live.contestants[0] ?? {}), false);

  const completed = store.getLiveScores(scenarioId, eventId, undefined, 'completed');
  assert.equal(store.getEventResponse(scenarioId, eventId, 'completed').event.status, 'completed');
  assert.ok(completed.contestants.some((contestant) => contestant.rounds.some((round) => round.round === 4)));
});

test('pool-master-eux.7: direct /scores requests expose every golf live-state wire contract', async () => {
  const previousScenarioDir = process.env.SCENARIO_DIR;
  process.env.SCENARIO_DIR = scenarioDir;
  const app = await buildApp();
  const tokens = [
    'golf-pre-live',
    'golf-r1-in-progress',
    'golf-r1-complete',
    'golf-r2-complete',
    'golf-correction',
    'golf-r4-complete-pending-final',
    'golf-playoff',
    'golf-completed',
    'golf-late-correction',
  ] as const;

  try {
    for (const token of tokens) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/scenarios/golf-major-2026/events/golf-masters-2026/scores?mockEventState=${token}`,
      });
      assert.equal(response.statusCode, 200);
      const payload = response.json<LiveScoresSnapshotResponse>();
      assert.equal(payload.feedKind, 'results');
      assert.equal(payload.eventId, 'golf-masters-2026');

      if (token === 'golf-pre-live') {
        assert.equal(payload.contestants.length, 0);
        continue;
      }

      assert.equal(payload.contestants.length, 80);
      assert.equal(Array.isArray(payload.contestants[0].rounds), true);
      assert.equal('score' in payload.contestants[0], false);
      assert.equal('strokes' in payload.contestants[0], false);
      assert.equal(typeof payload.contestants[0].rounds[0].strokes, 'number');
      assert.equal(typeof payload.contestants[0].rounds[0].scoreToPar, 'number');
    }
  } finally {
    await app.close();
    if (previousScenarioDir === undefined) {
      delete process.env.SCENARIO_DIR;
    } else {
      process.env.SCENARIO_DIR = previousScenarioDir;
    }
  }
});

test('ScenarioStore rejects new contestants in deltas unless they include a name', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mock-feed-scenario-'));

  try {
    writeFileSync(
      join(tempDir, 'invalid.json'),
      JSON.stringify({
        scenarioId: 'invalid-scenario',
        sport: 'GOLF',
        provider: 'mock-contest-feed',
        season: {
          seasonId: 'invalid-2026',
          name: 'Invalid Season',
          year: 2026,
        },
        events: [
          {
            eventId: 'invalid-event',
            name: 'Invalid Event',
            status: 'scheduled',
            schedule: {
              startsAt: '2026-04-10T15:00:00.000Z',
            },
            field: {
              asOf: '2026-04-01T12:00:00.000Z',
              status: 'announced',
              contestants: [{ contestantId: 'golfer-01', name: 'Known Player' }],
            },
            feeds: {
              odds: {
                asOf: '2026-04-01T12:00:00.000Z',
                contestants: [{ contestantId: 'golfer-02', odds: 11.5 }],
              },
              rankings: {
                asOf: '2026-04-01T12:00:00.000Z',
                contestants: [],
              },
              results: {
                asOf: '2026-04-14T12:00:00.000Z',
                contestants: [],
              },
            },
          },
        ],
      }),
    );

    assert.throws(
      () => new ScenarioStore(tempDir),
      /must include name when introducing a new contestant/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ScenarioStore rejects golf events that omit odds contestants', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mock-feed-scenario-'));

  try {
    writeFileSync(
      join(tempDir, 'invalid-golf-odds.json'),
      JSON.stringify({
        scenarioId: 'invalid-golf-odds',
        sport: 'GOLF',
        provider: 'mock-contest-feed',
        season: {
          seasonId: 'invalid-2026',
          name: 'Invalid Season',
          year: 2026,
        },
        events: [
          {
            eventId: 'invalid-event',
            name: 'Invalid Event',
            status: 'scheduled',
            schedule: {
              startsAt: '2026-04-10T15:00:00.000Z',
            },
            field: {
              asOf: '2026-04-01T12:00:00.000Z',
              status: 'announced',
              contestants: [{ contestantId: 'golfer-01', name: 'Known Player' }],
            },
            feeds: {
              odds: {
                asOf: '2026-04-01T12:00:00.000Z',
                contestants: [],
              },
              rankings: {
                asOf: '2026-04-01T12:00:00.000Z',
                contestants: [],
              },
              results: {
                asOf: '2026-04-14T12:00:00.000Z',
                contestants: [],
              },
            },
          },
        ],
      }),
    );

    assert.throws(
      () => new ScenarioStore(tempDir),
      /must include odds contestants/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ScenarioStore throws for missing scenarios and events', () => {
  const store = new ScenarioStore(scenarioDir);

  assert.throws(() => store.getScenario('missing-scenario'), /Scenario not found/);
  assert.throws(
    () => store.getEvent('golf-major-2026', 'missing-event'),
    /Event not found/,
  );
});

test('pool-master-33l.8.8: routes expose detail, field, and mock event-state score endpoints', async () => {
  const previousScenarioDir = process.env.SCENARIO_DIR;
  process.env.SCENARIO_DIR = scenarioDir;

  const app = buildApp();

  try {
    const detailResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/detail',
    });
    assert.equal(detailResponse.statusCode, 200);
    const detailJson = detailResponse.json<ContestFeedEventResponse>();
    assert.equal(detailJson.season.seasonId, 'golf-2026-majors');
    assert.equal(detailJson.event.schedule.fieldLocksAt, '2026-04-29T16:00:00.000Z');

    const fieldResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/field',
    });
    assert.equal(fieldResponse.statusCode, 200);
    const fieldJson = fieldResponse.json<ContestFeedSnapshotResponse>();
    assert.equal(fieldJson.feedKind, 'field');
    assert.equal(fieldJson.contestants.length, 80);

    const liveScoresResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/scores?tick=2&mockEventState=live',
    });
    assert.equal(liveScoresResponse.statusCode, 200);
    const liveScoresJson = liveScoresResponse.json<LiveScoresSnapshotResponse>();
    assert.equal(liveScoresJson.feedKind, 'results');
    assert.equal(liveScoresJson.contestants.length, 80);
    assert.equal(liveScoresJson.contestants[0]?.rounds.length, 1);
    assert.equal(liveScoresJson.contestants[0]?.rounds[0]?.status, 'IN_PROGRESS');
    assert.ok(typeof liveScoresJson.contestants[0]?.rounds[0]?.strokes === 'number');
  } finally {
    await app.close();
    if (previousScenarioDir === undefined) {
      delete process.env.SCENARIO_DIR;
    } else {
      process.env.SCENARIO_DIR = previousScenarioDir;
    }
  }
});
