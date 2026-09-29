import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIGRATION_NAME,
  assertExpectedFailedState,
} from './repair-sport-league-season-migration.mjs';

/**
 * #191 — the gate in front of `DELETE FROM public.seasons`.
 *
 * This is the only automated check on the function that authorises an irreversible delete
 * against the QA database. Its substrate sibling has had this coverage since the substrate
 * repair was written; the season repair shipped without it, and the season repair is the one
 * that actually runs on the next `main` push.
 *
 * Every case below asserts a refusal *before* any mutation, which is the property that makes
 * "delete every row in seasons" safe: the rows are provably unreferenced, the failure is
 * provably the P3018 null-column failure, and the transaction provably rolled back.
 */

const expectedObjectChecks = [
  ['column:seasons.sport_id_present', true],
  ['column:seasons.sport_league_id_absent', true],
  ['column:sport_events.season_id_absent', true],
  ['table:participant_league_affiliations_absent', true],
  ['table:sport_leagues_absent', true],
].map(([check_name, ok]) => ({ check_name, ok }));

const noForeignKeys = [];

function failedSeasonMigration() {
  return [{
    migration_name: MIGRATION_NAME,
    finished_at: null,
    rolled_back_at: null,
    logs: 'DbError: column "sport_league_id" of relation "seasons" contains null values',
  }];
}

describe('pool-master-191: season migration repair state gate', () => {
  it('accepts only the exact unresolved sport_league_id null-values failure shape', () => {
    assert.doesNotThrow(() => {
      assertExpectedFailedState(
        failedSeasonMigration(),
        expectedObjectChecks,
        noForeignKeys,
      );
    });
  });

  it('rejects a different migration failure before any repair mutation runs', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [{ ...failedSeasonMigration()[0], logs: 'DbError: permission denied' }],
        expectedObjectChecks,
        noForeignKeys,
      ),
      /failed for a reason other than seasons\.sport_league_id containing null values/,
    );
  });

  it('rejects a migration that already resolved, so a rerun cannot re-delete seasons', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [{ ...failedSeasonMigration()[0], rolled_back_at: new Date() }],
        expectedObjectChecks,
        noForeignKeys,
      ),
      /is not in the unresolved failed state/,
    );
  });

  it('rejects an ambiguous history with more than one row for the migration', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [failedSeasonMigration()[0], failedSeasonMigration()[0]],
        expectedObjectChecks,
        noForeignKeys,
      ),
      /Expected exactly one .* row, found 2/,
    );
  });

  it('rejects a transaction that did not fully roll back', () => {
    const partialChecks = expectedObjectChecks.map((row) => (
      row.check_name === 'table:sport_leagues_absent'
        ? { ...row, ok: false }
        : row
    ));

    assert.throws(
      () => assertExpectedFailedState(
        failedSeasonMigration(),
        partialChecks,
        noForeignKeys,
      ),
      /did not fully roll back as expected/,
    );
  });

  it('refuses to delete seasons rows that something still references', () => {
    assert.throws(
      () => assertExpectedFailedState(
        failedSeasonMigration(),
        expectedObjectChecks,
        [{
          referencing_table: 'sport_events',
          referencing_column: 'season_id',
          constraint_name: 'sport_events_season_id_fkey',
        }],
      ),
      /found live foreign key reference\(s\) into public\.seasons/,
    );
  });
});
