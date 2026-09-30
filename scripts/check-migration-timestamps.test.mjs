import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findAddedCollisions, timestampPrefix } from './check-migration-timestamps.mjs';

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
