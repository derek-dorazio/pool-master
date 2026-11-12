import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findAddedBeforeBase, findAddedCollisions, timestampPrefix } from './check-migration-timestamps.mjs';

// #266: #259 and #264 both landed a migration stamped 20260930140000.
const onMain = [
  '20260419223000_add_contest_entry_tiebreaker_value',
  '20260419223000_add_provider_sync_runs',
  '20260930130000_drop_audit_log_tables',
  '20260930140000_contest_entry_standing_split_participant_role',
  '20260930140000_drop_unbuilt_platform_tables',
];

describe('check-migration-timestamps (#266)', () => {
  it('reads the 14-digit timestamp prefix and ignores anything else', () => {
    assert.equal(timestampPrefix('20260930140000_drop_unbuilt_platform_tables'), '20260930140000');
    assert.equal(timestampPrefix('migration_lock.toml'), null);
  });

  it('passes the collisions already on main when the change adds nothing', () => {
    assert.deepEqual(findAddedCollisions({ added: [], known: onMain }), []);
  });

  it('passes an added migration with a fresh timestamp, despite the collisions already on main', () => {
    const added = ['20261001090000_rename_indexes'];
    assert.deepEqual(findAddedCollisions({ added, known: [...onMain, ...added] }), []);
  });

  it('fails an added migration that reuses a timestamp already on main, naming both', () => {
    const added = ['20260930130000_drop_more_tables'];
    assert.deepEqual(findAddedCollisions({ added, known: [...onMain, ...added] }), [
      {
        prefix: '20260930130000',
        names: ['20260930130000_drop_audit_log_tables', '20260930130000_drop_more_tables'],
      },
    ]);
  });

  it('fails two added migrations that share a timestamp with each other', () => {
    const added = ['20261001090000_a', '20261001090000_b'];
    assert.deepEqual(findAddedCollisions({ added, known: [...onMain, ...added] }), [
      { prefix: '20261001090000', names: ['20261001090000_a', '20261001090000_b'] },
    ]);
  });

  it('fails an added migration that joins one of main\'s existing pairs', () => {
    const added = ['20260930140000_third'];
    const [collision] = findAddedCollisions({ added, known: [...onMain, ...added] });
    assert.equal(collision.prefix, '20260930140000');
    assert.equal(collision.names.length, 3);
  });

  it('catches a collision with a migration main gained after the branch was cut', () => {
    // Locally, `known` also carries origin/main's migrations that the working tree lacks.
    const added = ['20261001090000_mine'];
    const landedSince = ['20261001090000_theirs'];
    assert.deepEqual(findAddedCollisions({ added, known: [...onMain, ...added, ...landedSince] }), [
      { prefix: '20261001090000', names: ['20261001090000_mine', '20261001090000_theirs'] },
    ]);
  });
});

// #1670: #1668 first added 20271117000600_set_pga_tour_match_keyword after main had gained
// 20271118000000_add_provider_event_sync_job_type, and the check passed.
describe('check-migration-timestamps: an added migration dated before the base\'s latest (#1670)', () => {
  const base = [
    '20271117000500_set_nba_clutch_card_match_keywords',
    '20271118000000_add_provider_event_sync_job_type',
    '20271118001000_add_sport_league_dedupe_key',
  ];

  it('fails an added migration dated before the base\'s latest, naming it and the base\'s latest', () => {
    assert.deepEqual(findAddedBeforeBase({ added: ['20271117000600_set_pga_tour_match_keyword'], base }), [
      { name: '20271117000600_set_pga_tour_match_keyword', latest: '20271118001000_add_sport_league_dedupe_key' },
    ]);
  });

  it('passes an added migration dated after the base\'s latest', () => {
    assert.deepEqual(findAddedBeforeBase({ added: ['20271118002000_set_pga_tour_match_keyword'], base }), []);
  });

  it('leaves an added migration sharing the base\'s latest timestamp to the duplicate check, which still fails it', () => {
    const added = ['20271118001000_mine'];
    assert.deepEqual(findAddedBeforeBase({ added, base }), []);
    assert.deepEqual(findAddedCollisions({ added, known: [...base, ...added] }), [
      { prefix: '20271118001000', names: ['20271118001000_add_sport_league_dedupe_key', '20271118001000_mine'] },
    ]);
  });

  it('fails only the added migrations dated too early, when a change adds several', () => {
    const added = ['20271117000600_early', '20271118003000_late'];
    assert.deepEqual(findAddedBeforeBase({ added, base }).map((each) => each.name), ['20271117000600_early']);
  });

  it('passes anything added against a base with no migrations, and ignores a name with no timestamp', () => {
    assert.deepEqual(findAddedBeforeBase({ added: ['20200101000000_first'], base: [] }), []);
    assert.deepEqual(findAddedBeforeBase({ added: ['migration_lock.toml'], base }), []);
  });
});
