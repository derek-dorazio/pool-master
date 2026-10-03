import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectScriptedRepair } from './run-migrations.mjs';

// Defect #191: QA's migrate task has exited 1 on every main push since
// 20260902110000_add_sport_league_season_roster failed there (P3018). Its
// repair script existed but run-migrations.mjs never invoked it, so every
// later `prisma migrate deploy` hit the unresolved failure and gave up.
describe('run-migrations selectScriptedRepair (defect #191)', () => {
  it('selects the season repair when the season migration is the unresolved failure', () => {
    const repair = selectScriptedRepair(['20260902110000_add_sport_league_season_roster']);

    assert.equal(repair?.migrationName, '20260902110000_add_sport_league_season_roster');
    assert.deepEqual(repair?.args, [
      'scripts/repair-sport-league-season-migration.mjs',
      '--apply',
      '--confirm-qa-season-repair',
    ]);
  });

  it('keeps selecting the substrate repair for the substrate migration', () => {
    const repair = selectScriptedRepair(['20260506211309_substrate_redesign_phase4_foundation']);

    assert.equal(repair?.migrationName, '20260506211309_substrate_redesign_phase4_foundation');
    assert.deepEqual(repair?.args, [
      'scripts/repair-substrate-foundation-migration.mjs',
      '--apply',
      '--confirm-qa-substrate-repair',
    ]);
  });

  // plans/147 slice 2 — the Season collapse refuses on data its backfill would have to
  // guess about, and a refusal leaves the failed row that makes Prisma answer P3009 to
  // every later deploy. Without this entry the migrate task would exit 1 on every push,
  // which is defect #191 again.
  it('selects the season-collapse repair when the collapse migration is the unresolved failure', () => {
    const repair = selectScriptedRepair(['20261003180000_collapse_season_into_event_year']);

    assert.equal(repair?.migrationName, '20261003180000_collapse_season_into_event_year');
    assert.deepEqual(repair?.args, [
      'scripts/repair-season-collapse-migration.mjs',
      '--apply',
      '--confirm-qa-season-collapse-repair',
    ]);
  });

  it('selects nothing for an unresolved failure no script knows how to repair', () => {
    assert.equal(selectScriptedRepair(['20260926090000_squad_name_unique_per_league_drop_league_created_by']), null);
    assert.equal(selectScriptedRepair([]), null);
  });
});
