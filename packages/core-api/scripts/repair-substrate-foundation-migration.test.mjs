import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIGRATION_NAME,
  assertExpectedFailedState,
} from './repair-substrate-foundation-migration.mjs';

const expectedObjectChecks = [
  ['table:plan_tiers', true],
  ['type:PrismaSportCategory', false],
  ['type:PrismaTournamentFormat', false],
  ['type:PrismaContestFormat', false],
  ['table:contest_sport_events', false],
  ['table:contest_entry_picks', false],
  ['table:contest_entry_pick_golf_roster_contributions', false],
  ['table:sport_event_participant_golf_rounds', false],
  ['old_table:roster_picks_absent', false],
  ['old_table:sport_event_participant_source_data_absent', false],
  ['old_table:participant_season_records_absent', false],
  ['column:sports.category', false],
  ['column:sports.tournament_format', false],
  ['old_column:sports.stat_schema_absent', false],
  ['column:contests.contest_format', false],
  ['old_column:contests.contest_type_absent', false],
  ['column:sport_event_participants.world_ranking', false],
  ['column:sport_event_participants.odds_to_win', false],
  ['column:sport_event_participants.seed_number', false],
  ['column:contest_entry_participant_scores.pick_id', false],
  ['old_column:contest_entry_participant_scores.roster_pick_id_absent', false],
  ['column:draft_pick_histories.pick_id', false],
  ['old_column:draft_pick_histories.roster_pick_id_absent', false],
  ['old_column:participants.metadata_absent', false],
].map(([check_name, ok]) => ({ check_name, ok }));

const emptyRowCounts = [
  'contest_entry_participant_scores',
  'draft_pick_histories',
  'roster_picks',
  'sport_event_participant_source_data',
  'participant_season_records',
  'plan_tiers',
].map((table_name) => ({ table_name, row_count: 0 }));

function failedPlanTiersMigration() {
  return [{
    migration_name: MIGRATION_NAME,
    finished_at: null,
    rolled_back_at: null,
    logs: 'DbError: relation "plan_tiers" already exists',
  }];
}

describe('pool-master-mmj: substrate migration repair state gate', () => {
  it('accepts only the exact unresolved plan_tiers failure shape', () => {
    assert.doesNotThrow(() => {
      assertExpectedFailedState(
        failedPlanTiersMigration(),
        expectedObjectChecks,
        emptyRowCounts,
      );
    });
  });

  it('rejects a different migration failure before any repair mutation runs', () => {
    assert.throws(
      () => assertExpectedFailedState(
        [{ ...failedPlanTiersMigration()[0], logs: 'DbError: permission denied' }],
        expectedObjectChecks,
        emptyRowCounts,
      ),
      /failed for a reason other than plan_tiers already existing/,
    );
  });

  it('rejects a partially applied substrate migration beyond plan_tiers', () => {
    const partialChecks = expectedObjectChecks.map((row) => (
      row.check_name === 'table:contest_entry_picks'
        ? { ...row, ok: true }
        : row
    ));

    assert.throws(
      () => assertExpectedFailedState(
        failedPlanTiersMigration(),
        partialChecks,
        emptyRowCounts,
      ),
      /appears partially applied beyond plan_tiers/,
    );
  });

  it('rejects non-empty legacy score rows that would need a real data backfill', () => {
    const nonEmptyScoreRows = emptyRowCounts.map((row) => (
      row.table_name === 'contest_entry_participant_scores'
        ? { ...row, row_count: 1 }
        : row
    ));

    assert.throws(
      () => assertExpectedFailedState(
        failedPlanTiersMigration(),
        expectedObjectChecks,
        nonEmptyScoreRows,
      ),
      /contest_entry_participant_scores is not empty/,
    );
  });
});
