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

test('ScenarioStore generates relative today golf events for QA lifecycle coverage', () => {
  const now = new Date('2026-04-26T21:00:00.000Z');
  const scenario = buildRelativeTodayGolfScenario(now);

  assert.equal(scenario.scenarioId, 'golf-relative-today');
  assert.deepEqual(
    scenario.events.map((event) => event.eventId),
    [
      'golf-relative-live-now',
      'golf-relative-locked-tomorrow',
      'golf-relative-ready-5d',
      'golf-relative-field-pending-6d',
      'golf-relative-participant-boundary-7d',
      'golf-relative-schedule-boundary-30d',
    ],
  );

  const liveNow = scenario.events.find((event) => event.eventId === 'golf-relative-live-now');
  assert.equal(liveNow?.status, 'in_progress');
  assert.equal(liveNow?.field.status, 'locked');
  assert.equal(liveNow?.field.contestants.length, 80);

  const lockedTomorrow = scenario.events.find((event) => event.eventId === 'golf-relative-locked-tomorrow');
  assert.equal(lockedTomorrow?.schedule.startsAt, '2026-04-27T12:00:00.000Z');
  assert.ok(Date.parse(lockedTomorrow?.schedule.fieldLocksAt ?? '') < now.getTime());

  const ready = scenario.events.find((event) => event.eventId === 'golf-relative-ready-5d');
  assert.equal(ready?.schedule.startsAt, '2026-05-01T12:00:00.000Z');
  assert.ok(Date.parse(ready?.schedule.releaseAt ?? '') < now.getTime());
  assert.ok(Date.parse(ready?.schedule.fieldLocksAt ?? '') > now.getTime());
  assert.equal(ready?.field.contestants.length, 80);

  const pending = scenario.events.find((event) => event.eventId === 'golf-relative-field-pending-6d');
  assert.equal(pending?.schedule.startsAt, '2026-05-02T12:00:00.000Z');
  assert.ok(Date.parse(pending?.schedule.releaseAt ?? '') > now.getTime());

  const participantBoundary = scenario.events.find((event) => event.eventId === 'golf-relative-participant-boundary-7d');
  assert.equal(participantBoundary?.schedule.startsAt, '2026-05-03T12:00:00.000Z');

  const scheduleBoundary = scenario.events.find((event) => event.eventId === 'golf-relative-schedule-boundary-30d');
  assert.equal(scheduleBoundary?.schedule.startsAt, '2026-05-26T11:00:00.000Z');
});

test('ScenarioStore includes generated relative today events in the scenario catalog', () => {
  const store = new ScenarioStore(
    scenarioDir,
    undefined,
    { now: () => new Date('2026-04-26T21:00:00.000Z') },
  );

  const relativeScenario = store.getScenario('golf-relative-today');
  assert.equal(relativeScenario.events.length, 6);

  const events = store.listEvents('golf-relative-today');
  assert.equal(events[0]?.eventId, 'golf-relative-live-now');
  assert.equal(events.at(-1)?.eventId, 'golf-relative-schedule-boundary-30d');

  const readyDetail = store.getEventResponse('golf-relative-today', 'golf-relative-ready-5d');
  assert.equal(readyDetail.event.field.contestants.length, 80);
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
      url: '/v1/live/scenarios/golf-major-2026/events/golf-masters-2026/scores?tick=2',
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
