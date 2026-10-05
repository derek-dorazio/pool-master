import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectScriptedRepair } from './run-migrations.mjs';

// Defect #191: QA's migrate task has exited 1 on every main push since
// 20260902110000_add_sport_league_season_roster failed there (P3018). Its
// repair script existed but run-migrations.mjs never invoked it, so every
// later `prisma migrate deploy` hit the unresolved failure and gave up.
//
// #91 deleted the three repair scripts and emptied the registry they were
// registered in, so there is no longer a per-migration repair to select. What
// is left to guard is that the dispatch stays inert rather than throwing or
// selecting something: an unresolved failure now falls through to the loud
// error, and QA is recovered with the Reset QA database workflow.
describe('run-migrations selectScriptedRepair (defect #191, registry emptied by #91)', () => {
  it('selects nothing, because no migration has a scripted repair any more', () => {
    assert.equal(selectScriptedRepair(['20260926090000_squad_name_unique_per_league_drop_league_created_by']), null);
    assert.equal(selectScriptedRepair(['20260506211309_substrate_redesign_phase4_foundation']), null);
    assert.equal(selectScriptedRepair(['20260902110000_add_sport_league_season_roster']), null);
    assert.equal(selectScriptedRepair(['20261003180000_collapse_season_into_event_year']), null);
    assert.equal(selectScriptedRepair([]), null);
  });
});
