import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLEARED_TABLES,
  MIGRATION_NAME,
  assertExpectedFailedState,
} from './repair-season-collapse-migration.mjs';

/**
 * plans/147 slice 2 (#315) — the gate in front of deleting season-less sport_events.
 *
 * The collapse migration has four pre-write checks. Only the season-less one (step 0a) may
 * be repaired by a script: those rows came from provider sync, nothing records which tour
 * they belong to, and this slice removes the path that made them. The other three each need
 * a decision about which row is real, so every case below asserts a refusal *before* any
 * mutation — which is what makes an irreversible delete against QA safe.
 */

const preMigrationShape = [
  ['column:sport_events.event_year_absent', true],
  ['column:sport_events.season_id_present', true],
  ['table:event_series_present', true],
  ['table:seasons_present', true],
].map(([check_name, ok]) => ({ check_name, ok }));

const seasonlessEvents = [
  { id: '00000000-0000-0000-0000-0000000000a1', name: 'The RSM Classic', provider_id: 'sportsdata' },
];

const noBlockingReferences = [];

function failedCollapseMigration() {
  return [{
    migration_name: MIGRATION_NAME,
    finished_at: null,
    rolled_back_at: null,
    logs:
      'ERROR: plans/147: 1 sport_events have no season, so no tour to derive a series from '
      + 'and no year. Assign each a season or delete it, then re-run.',
  }];
}

describe('plans/147 season-collapse repair state gate', () => {
  it('accepts only the unresolved season-less failure shape', () => {
    assert.doesNotThrow(() => {
      assertExpectedFailedState(
        failedCollapseMigration(),
        preMigrationShape,
        seasonlessEvents,
        noBlockingReferences,
      );
    });
  });

  it('refuses the duplicate-edition check, which needs an owner decision', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [{
          ...failedCollapseMigration()[0],
          logs: 'ERROR: plans/147: 1 (series, year) pairs have more than one edition.',
        }],
        preMigrationShape,
        seasonlessEvents,
        noBlockingReferences,
      ),
      /failed on a check other than "sport_events have no season"/,
    );
  });

  it('refuses the crossed-tour check, which needs an owner decision', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [{
          ...failedCollapseMigration()[0],
          logs: 'ERROR: plans/147: 1 sport_events belong to a series of one tour and a season of another.',
        }],
        preMigrationShape,
        seasonlessEvents,
        noBlockingReferences,
      ),
      /need a decision about which row is real/,
    );
  });

  it('refuses a migration that already finished or was already rolled back', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [{ ...failedCollapseMigration()[0], finished_at: new Date() }],
        preMigrationShape,
        seasonlessEvents,
        noBlockingReferences,
      ),
      /is not in the unresolved failed state/,
    );
    assert.throws(
      () => assertExpectedFailedState(
        [{ ...failedCollapseMigration()[0], rolled_back_at: new Date() }],
        preMigrationShape,
        seasonlessEvents,
        noBlockingReferences,
      ),
      /is not in the unresolved failed state/,
    );
  });

  // The checks precede the first write, so a database that has already moved on is not the
  // state this script understands — and deleting events in it could destroy real rows.
  it('refuses a database that is not in the pre-migration shape', () => {
    assert.throws(
      () => assertExpectedFailedState(
        failedCollapseMigration(),
        preMigrationShape.map((row) => (
          row.check_name === 'table:seasons_present' ? { ...row, ok: false } : row
        )),
        seasonlessEvents,
        noBlockingReferences,
      ),
      /not in the pre-migration shape/,
    );
  });

  it('refuses when the rows the failure named are no longer there', () => {
    assert.throws(
      () => assertExpectedFailedState(
        failedCollapseMigration(),
        preMigrationShape,
        [],
        noBlockingReferences,
      ),
      /no season-less sport_events remain/,
    );
  });

  // A contest on one of these events means someone built on it: it is product data, not
  // sync residue, and `deleteEvent` refuses it for the same reason.
  it('refuses when a contest or any other unknown child references the rows', () => {
    assert.throws(
      () => assertExpectedFailedState(
        failedCollapseMigration(),
        preMigrationShape,
        seasonlessEvents,
        [{ referencing_table: 'contests', referencing_column: 'sport_event_id', count: 1 }],
      ),
      /A contest on one of these events means it is real data/,
    );
  });

  it('never clears contests as part of its own cascade', () => {
    assert.equal(CLEARED_TABLES.has('contests'), false);
    assert.equal(CLEARED_TABLES.has('sport_events'), true);
  });

  it('refuses more than one row for the migration, which means manual triage happened', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [...failedCollapseMigration(), ...failedCollapseMigration()],
        preMigrationShape,
        seasonlessEvents,
        noBlockingReferences,
      ),
      /Expected exactly one .* row, found 2/,
    );
  });
});
