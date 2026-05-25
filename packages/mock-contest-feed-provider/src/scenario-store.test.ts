import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildApp } from './app';
import { ScenarioStore, buildRelativeTodayGolfScenario } from './scenario-store';

const scenarioDir = resolve(process.cwd(), 'contest-feed-scenarios');

test('ScenarioStore loads event-first scenarios and exposes field snapshots', () => {
  const store = new ScenarioStore(scenarioDir);

  const scenarios = store.listScenarios();
  assert.ok(scenarios.length >= 5);

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

test('pool-master-33l.8.7: ScenarioStore generates rolling Thursday-Sunday golf events for QA coverage', () => {
  const now = new Date('2026-04-26T21:00:00.000Z');
  const scenario = buildRelativeTodayGolfScenario(now);

  assert.equal(scenario.scenarioId, 'golf-relative-today');
  const manualEventId = 'golf-relative-manual-test-20260426t214000z';
  assert.deepEqual(
    scenario.events.map((event) => event.eventId),
    [
      manualEventId,
      'golf-relative-weekend-20260430',
      'golf-relative-weekend-20260507',
    ],
  );

  const manualEvent = scenario.events.find((event) => event.eventId === manualEventId);
  assert.equal(manualEvent?.name, 'Manual Test Golf Tournament for 2026-04-26T21:40:00.000Z');
  assert.equal(manualEvent?.status, 'field_announced');
  assert.equal(manualEvent?.field.status, 'announced');
  assert.equal(manualEvent?.schedule.releaseAt, '2026-04-26T20:55:00.000Z');
  assert.equal(manualEvent?.schedule.fieldLocksAt, '2026-04-26T21:20:00.000Z');
  assert.equal(manualEvent?.schedule.startsAt, '2026-04-26T21:40:00.000Z');
  assert.equal(manualEvent?.schedule.endsAt, '2026-04-26T22:00:00.000Z');
  assert.equal(manualEvent?.field.contestants.length, 80);

  const firstWeekend = scenario.events.find((event) => event.eventId === 'golf-relative-weekend-20260430');
  assert.equal(firstWeekend?.name, 'Rolling QA Weekend 1 Championship (2026-04-30)');
  assert.equal(firstWeekend?.status, 'field_announced');
  assert.equal(firstWeekend?.field.status, 'announced');
  assert.equal(firstWeekend?.schedule.releaseAt, '2026-04-16T12:00:00.000Z');
  assert.equal(firstWeekend?.schedule.fieldLocksAt, '2026-04-29T16:00:00.000Z');
  assert.equal(firstWeekend?.schedule.startsAt, '2026-04-30T12:00:00.000Z');
  assert.equal(firstWeekend?.schedule.endsAt, '2026-05-03T22:00:00.000Z');
  assert.equal(firstWeekend?.metadata?.eventType, 'rolling-weekend-qa');
  assert.ok(Date.parse(firstWeekend?.schedule.startsAt ?? '') > now.getTime());
  assert.ok(Date.parse(firstWeekend?.schedule.releaseAt ?? '') < now.getTime());
  assert.ok(Date.parse(firstWeekend?.schedule.fieldLocksAt ?? '') > now.getTime());
  assert.equal(firstWeekend?.field.contestants.length, 80);

  const secondWeekend = scenario.events.find((event) => event.eventId === 'golf-relative-weekend-20260507');
  assert.equal(secondWeekend?.name, 'Rolling QA Weekend 2 Championship (2026-05-07)');
  assert.equal(secondWeekend?.schedule.releaseAt, '2026-04-23T12:00:00.000Z');
  assert.equal(secondWeekend?.schedule.fieldLocksAt, '2026-05-06T16:00:00.000Z');
  assert.equal(secondWeekend?.schedule.startsAt, '2026-05-07T12:00:00.000Z');
  assert.equal(secondWeekend?.schedule.endsAt, '2026-05-10T22:00:00.000Z');
  assert.equal(secondWeekend?.metadata?.eventType, 'rolling-weekend-qa');
  assert.ok(Date.parse(secondWeekend?.schedule.startsAt ?? '') > Date.parse(firstWeekend?.schedule.startsAt ?? ''));
  assert.equal(secondWeekend?.field.contestants.length, 80);
});

test('pool-master-33l.8.7: ScenarioStore chooses the next rolling Thursday tee time across UTC boundaries', () => {
  const rollingEventIdsFor = (now: string): readonly string[] =>
    buildRelativeTodayGolfScenario(new Date(now)).events
      .filter((event) => event.metadata?.eventType === 'rolling-weekend-qa')
      .map((event) => event.eventId);

  const cases = [
    {
      now: '2026-04-29T10:00:00.000Z',
      eventIds: ['golf-relative-weekend-20260430', 'golf-relative-weekend-20260507'],
    },
    {
      now: '2026-04-30T11:59:00.000Z',
      eventIds: ['golf-relative-weekend-20260430', 'golf-relative-weekend-20260507'],
    },
    {
      now: '2026-04-30T12:00:00.000Z',
      eventIds: ['golf-relative-weekend-20260507', 'golf-relative-weekend-20260514'],
    },
    {
      now: '2026-04-30T12:01:00.000Z',
      eventIds: ['golf-relative-weekend-20260507', 'golf-relative-weekend-20260514'],
    },
    {
      now: '2026-05-03T21:00:00.000Z',
      eventIds: ['golf-relative-weekend-20260507', 'golf-relative-weekend-20260514'],
    },
    {
      now: '2026-03-08T06:30:00.000Z',
      eventIds: ['golf-relative-weekend-20260312', 'golf-relative-weekend-20260319'],
    },
    {
      now: '2026-12-30T23:00:00.000Z',
      eventIds: ['golf-relative-weekend-20261231', 'golf-relative-weekend-20270107'],
    },
  ] as const;

  for (const testCase of cases) {
    assert.deepEqual(rollingEventIdsFor(testCase.now), testCase.eventIds);
  }
});

test('pool-master-xw5.5 + pool-master-33l.8.7: relative manual-test event advances through 20-minute lifecycle windows', () => {
  const anchor = new Date('2026-04-26T21:00:00.000Z');
  const cases = [
    {
      now: new Date('2026-04-26T21:10:00.000Z'),
      status: 'field_announced',
      fieldStatus: 'announced',
      result: 'pending',
    },
    {
      now: new Date('2026-04-26T21:25:00.000Z'),
      status: 'field_announced',
      fieldStatus: 'locked',
      result: 'pending',
    },
    {
      now: new Date('2026-04-26T21:45:00.000Z'),
      status: 'in_progress',
      fieldStatus: 'locked',
      result: 'pending',
    },
    {
      now: new Date('2026-04-26T22:05:00.000Z'),
      status: 'completed',
      fieldStatus: 'final',
      result: 'win',
    },
  ] as const;

  for (const testCase of cases) {
    const scenario = buildRelativeTodayGolfScenario(testCase.now, { manualTestAnchor: anchor });
    const manualEvent = scenario.events.find((event) => event.metadata?.eventType === 'relative-manual-test');

    assert.equal(manualEvent?.status, testCase.status);
    assert.equal(manualEvent?.field.status, testCase.fieldStatus);
    assert.equal(manualEvent?.field.contestants.length, 80);
    assert.equal(manualEvent?.feeds.results.contestants[0]?.result, testCase.result);
  }
});

test('pool-master-xw5.5 + pool-master-33l.8.7: ScenarioStore includes generated relative today events in the scenario catalog', () => {
  let currentNow = new Date('2026-04-26T21:00:00.000Z');
  const store = new ScenarioStore(
    scenarioDir,
    undefined,
    { now: () => currentNow },
  );

  const relativeScenario = store.getScenario('golf-relative-today');
  assert.equal(relativeScenario.events.length, 3);

  const events = store.listEvents('golf-relative-today');
  assert.equal(events[0]?.eventId, 'golf-relative-manual-test-20260426t214000z');
  assert.equal(events[0]?.status, 'field_announced');
  assert.equal(events.at(-1)?.eventId, 'golf-relative-weekend-20260507');

  const weekendDetail = store.getEventResponse('golf-relative-today', 'golf-relative-weekend-20260430');
  assert.equal(weekendDetail.event.field.contestants.length, 80);
  assert.equal(weekendDetail.event.schedule.startsAt, '2026-04-30T12:00:00.000Z');

  currentNow = new Date('2026-04-26T21:45:00.000Z');
  const liveEvents = store.listEvents('golf-relative-today');
  assert.equal(liveEvents[0]?.eventId, 'golf-relative-manual-test-20260426t214000z');
  assert.equal(liveEvents[0]?.status, 'in_progress');

  const liveScores = store.getLiveScores('golf-relative-today', 'golf-relative-manual-test-20260426t214000z');
  assert.equal(liveScores.contestants.length, 80);
  assert.equal(liveScores.contestants[0]?.result, 'pending');

  currentNow = new Date('2026-04-26T22:05:00.000Z');
  const results = store.getSnapshot('golf-relative-today', 'golf-relative-manual-test-20260426t214000z', 'results');
  assert.equal(results.contestants.length, 80);
  assert.ok(results.contestants.some((contestant) => contestant.result === 'win'));

  currentNow = new Date('2026-04-26T22:25:00.000Z');
  const nextCycleEvents = store.listEvents('golf-relative-today');
  assert.equal(nextCycleEvents[0]?.eventId, 'golf-relative-manual-test-20260426t230500z');
  assert.equal(nextCycleEvents[0]?.status, 'field_announced');
  assert.equal(nextCycleEvents.at(-1)?.eventId, 'golf-relative-weekend-20260507');
});

test('pool-master-s4y: old relative manual-test event ids remain detail-resolvable after cycle rollover', () => {
  let currentNow = new Date('2026-04-26T21:00:00.000Z');
  const store = new ScenarioStore(
    scenarioDir,
    undefined,
    { now: () => currentNow },
  );

  const originalEventId = 'golf-relative-manual-test-20260426t214000z';
  assert.equal(store.getEventResponse('golf-relative-today', originalEventId).event.eventId, originalEventId);

  currentNow = new Date('2026-04-26T22:25:00.000Z');
  assert.equal(store.listEvents('golf-relative-today')[0]?.eventId, 'golf-relative-manual-test-20260426t230500z');

  const originalDetail = store.getEventResponse('golf-relative-today', originalEventId);
  assert.equal(originalDetail.event.eventId, originalEventId);
  assert.equal(originalDetail.event.name, 'Manual Test Golf Tournament for 2026-04-26T21:40:00.000Z');
  assert.equal(originalDetail.event.field.contestants.length, 80);
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

test('routes expose detail and field endpoints', async () => {
  const previousScenarioDir = process.env.SCENARIO_DIR;
  process.env.SCENARIO_DIR = scenarioDir;

  const app = buildApp();

  try {
    const detailResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/detail',
    });
    assert.equal(detailResponse.statusCode, 200);
    const detailJson = detailResponse.json();
    assert.equal(detailJson.season.seasonId, 'golf-2026-majors');
    assert.equal(detailJson.event.schedule.fieldLocksAt, '2026-04-29T16:00:00.000Z');

    const fieldResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/field',
    });
    assert.equal(fieldResponse.statusCode, 200);
    const fieldJson = fieldResponse.json();
    assert.equal(fieldJson.feedKind, 'field');
    assert.equal(fieldJson.contestants.length, 80);

    const liveScoresResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/scores?tick=2',
    });
    assert.equal(liveScoresResponse.statusCode, 200);
    const liveScoresJson = liveScoresResponse.json();
    assert.equal(liveScoresJson.feedKind, 'results');
    assert.equal(liveScoresJson.contestants.length, 80);
    assert.ok(typeof liveScoresJson.contestants[0]?.score === 'number');
  } finally {
    await app.close();
    if (previousScenarioDir === undefined) {
      delete process.env.SCENARIO_DIR;
    } else {
      process.env.SCENARIO_DIR = previousScenarioDir;
    }
  }
});
