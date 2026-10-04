import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SPORTS, bootstrapSports } from './bootstrap-sports.mjs';

/**
 * The gap the first QA reset exposed: a reset database has an empty `sports` table, nothing in
 * the repository seeds one, and without the GOLF row every golf admin screen fails to render —
 * `golfSportQueryOptions` throws "The golf sport is not set up." and the lists built on it never
 * appear. The post-deploy journey failed in act 1 waiting for a table that could not exist.
 */
function fakePrisma(existing = []) {
  const rows = [...existing];
  const calls = [];
  return {
    calls,
    rows,
    sport: {
      upsert: async ({ where, create, update, select }) => {
        calls.push({ where, create, update, select });
        const found = rows.find((row) => row.name === where.name);
        if (found) {
          Object.assign(found, update);
          return found;
        }
        const row = { id: `id-${create.name}`, ...create };
        rows.push(row);
        return row;
      },
    },
  };
}

describe('bootstrap-sports', () => {
  it('creates the GOLF row on an empty database', async () => {
    const prisma = fakePrisma();
    const result = await bootstrapSports(prisma);
    assert.equal(result.length, 1);
    assert.equal(prisma.rows.length, 1);
    assert.deepEqual(
      { ...prisma.rows[0], id: undefined },
      {
        id: undefined,
        name: 'GOLF',
        participantType: 'INDIVIDUAL',
        category: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
    );
  });

  // `tournamentFormat` has no column default on purpose (#236), so omitting it would make the
  // insert fail rather than quietly produce a wrong row — but only at runtime, on QA.
  it('states every field the sports table requires', () => {
    for (const sport of SPORTS) {
      assert.ok(sport.name, 'name');
      assert.ok(sport.participantType, 'participantType');
      assert.ok(sport.tournamentFormat, 'tournamentFormat is required: #236 gave it no default');
      assert.ok(sport.category, 'category');
    }
  });

  it('is idempotent, and leaves an existing row\'s contents alone', async () => {
    // A row corrected by hand must survive: this script guarantees the row exists, it does not
    // own what is in it.
    const prisma = fakePrisma([
      { id: 'existing', name: 'GOLF', participantType: 'TEAM', category: 'GOLF', tournamentFormat: 'MATCH_PLAY' },
    ]);
    await bootstrapSports(prisma);
    await bootstrapSports(prisma);
    assert.equal(prisma.rows.length, 1);
    assert.equal(prisma.rows[0].participantType, 'TEAM');
    assert.equal(prisma.rows[0].tournamentFormat, 'MATCH_PLAY');
    assert.deepEqual(prisma.calls.map((call) => call.update), [{}, {}]);
  });

  // Only the sport the product implements. Creating an event for any other is refused with 422
  // SPORT_NOT_SUPPORTED, and PrismaSportCategory has no value for several of the enum's sports,
  // so seeding them all would invent rows nothing can use.
  it('seeds golf only', () => {
    assert.deepEqual(SPORTS.map((sport) => sport.name), ['GOLF']);
  });
});
