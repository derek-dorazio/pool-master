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
  assert.deepEqual(
    scenario.events.map((event) => event.eventId),
    [
      'golf-relative-weekend-20260430',
      'golf-relative-weekend-20260507',
    ],
  );

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

test('pool-master-xw5.5 + pool-master-33l.8.7: ScenarioStore includes generated relative today events in the scenario catalog', () => {
  let currentNow = new Date('2026-04-26T21:00:00.000Z');
  const store = new ScenarioStore(
    scenarioDir,
    undefined,
    { now: () => currentNow },
  );

  const relativeScenario = store.getScenario('golf-relative-today');
  assert.equal(relativeScenario.events.length, 2);

  const events = store.listEvents('golf-relative-today');
  assert.equal(events[0]?.eventId, 'golf-relative-weekend-20260430');
  assert.equal(events[0]?.status, 'field_announced');
  assert.equal(events.at(-1)?.eventId, 'golf-relative-weekend-20260507');

  const weekendDetail = store.getEventResponse('golf-relative-today', 'golf-relative-weekend-20260430');
  assert.equal(weekendDetail.event.field.contestants.length, 80);
  assert.equal(weekendDetail.event.schedule.startsAt, '2026-04-30T12:00:00.000Z');

  currentNow = new Date('2026-04-26T22:25:00.000Z');
  const nextCycleEvents = store.listEvents('golf-relative-today');
  assert.equal(nextCycleEvents[0]?.eventId, 'golf-relative-weekend-20260430');
  assert.equal(nextCycleEvents[0]?.status, 'field_announced');
  assert.equal(nextCycleEvents.at(-1)?.eventId, 'golf-relative-weekend-20260507');
});

test('pool-master-33l.8.8: explicit mock event states control golf detail, results, and live scores', () => {
  const store = new ScenarioStore(
    scenarioDir,
    undefined,
    { now: () => new Date('2026-04-26T21:00:00.000Z') },
  );
  const eventId = 'golf-relative-weekend-20260430';

  const openDetail = store.getEventResponse('golf-relative-today', eventId, 'open');
  assert.equal(openDetail.event.status, 'field_announced');
  assert.equal(openDetail.event.field.status, 'announced');
  assert.equal(store.getLiveScores('golf-relative-today', eventId, undefined, 'open').contestants.length, 0);

  const lockedDetail = store.getEventResponse('golf-relative-today', eventId, 'locked');
  assert.equal(lockedDetail.event.status, 'field_announced');
  assert.equal(lockedDetail.event.field.status, 'locked');
  assert.equal(store.getLiveScores('golf-relative-today', eventId, undefined, 'locked').contestants.length, 0);

  const liveDetail = store.getEventResponse('golf-relative-today', eventId, 'live');
  assert.equal(liveDetail.event.status, 'in_progress');
  assert.equal(liveDetail.event.field.status, 'locked');
  const liveScores = store.getLiveScores('golf-relative-today', eventId, 2, 'live');
  assert.equal(liveScores.contestants.length, 80);
  assert.ok(typeof liveScores.contestants[0]?.score === 'number');
  assert.ok(typeof liveScores.contestants[0]?.strokes === 'number');

  const completedDetail = store.getEventResponse('golf-relative-today', eventId, 'completed');
  assert.equal(completedDetail.event.status, 'completed');
  assert.equal(completedDetail.event.field.status, 'final');
  const completedResults = store.getSnapshot('golf-relative-today', eventId, 'results', 'completed');
  assert.equal(completedResults.contestants.length, 80);
  assert.ok(completedResults.contestants.some((contestant) => contestant.result === 'win'));
  assert.ok(completedResults.contestants.every((contestant) => typeof contestant.strokes === 'number'));
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
  assert.ok(
    store.listEvents('golf-relative-today').every((event) =>
      !event.eventId.startsWith('golf-relative-manual-test-')),
  );

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
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/scores?tick=2&mockEventState=live',
    });
    assert.equal(liveScoresResponse.statusCode, 200);
    const liveScoresJson = liveScoresResponse.json();
    assert.equal(liveScoresJson.feedKind, 'results');
    assert.equal(liveScoresJson.contestants.length, 80);
    assert.ok(typeof liveScoresJson.contestants[0]?.score === 'number');
    assert.ok(typeof liveScoresJson.contestants[0]?.strokes === 'number');
  } finally {
    await app.close();
    if (previousScenarioDir === undefined) {
      delete process.env.SCENARIO_DIR;
    } else {
      process.env.SCENARIO_DIR = previousScenarioDir;
    }
  }
});
