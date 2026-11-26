/**
 * #1761 — a stored leaderboard is served as it was stored, so a change to any leaderboard
 * response's shape must bump `LEADERBOARD_BOARD_FORMAT`, or boards stored before the deploy lack
 * the new field and answer 500 (`rules/service-rules.md` §4 *Response Rules*).
 *
 * This guard hashes the shape of the four leaderboard responses in the committed contract
 * (`api:check` keeps it fresh), leaving out the words (descriptions, titles, examples), and
 * compares it with the hash recorded for the current format.
 *
 * WHEN IT FAILS: bump `LEADERBOARD_BOARD_FORMAT` by one and ADD a row for the new format below
 * with the hash it prints. Never edit an existing row: each row is the shape that format stored.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { LEADERBOARD_BOARD_FORMAT } from '../../../packages/core-api/src/modules/contests/leaderboard-snapshots';

const SHAPE_HASH_BY_FORMAT: Readonly<Record<number, string>> = {
  1: '904e71cf6f273fa03c7ea11a859a7ade3022ca52f6e4501cbdd3c7ca92e2f754',
  2: 'de64bb3ca1096b7392dc538f6f2a44e4d342498850cbef6a7fe9c686d6bedd38',
  3: '9662735145ab07cfb15d66492d73ec044bdfcbecad079abdde9623103e75e20b',
  4: '73a8c17ffc456c015c622801f9a74adee70ecbdbc7fb068eaa88e59e4a383b7b',
  5: '147a8f52a89a2cafcc8e6562631d477d8bd4f183a582b0c8f67a2bd49f7e3bff',
  // #1853: a participant belongs to one sport league (sportLeagueId and ranking, no sportId).
  6: 'e4195bfd7a7880779571958590df34a806cb9cf92a95c8b3d0d211a2133bf29b',
  // The old Clutch Card leagues removed: a pick carries no composite block.
  7: 'f2763f53932748563e612cd03bf7c36a7a7253c809fe7f74758b143a61f47f99',
  // #2040: AUTO_NAME leaves the valuation sources. A narrowing, so a format-7 task still serves a
  // format-8 board; participants keep their deprecated, always-empty externalIds.
  8: '4da23d0c552682230276679f528469edafebffb7a52380e4adaa408d7c9227b2',
  // League model 3 (#2000): SportEventMatchDto renamed SportEventRoundMatchDto; the fields are the same.
  9: '39e1f479550d5d8165a2637da525300e23b9c80b0b46195c5e4e89888d417fd7',
  // #2001: every event's participant type and scoring family are its sport league's, never null.
  10: '58120758bdb8bdd2699cf553d78dd39c972dbcbc73e8a49f3bb546d7bee4d5fc',
  // #2143: the sport code AMERICAN_FOOTBALL is FOOTBALL.
  11: '6df4bde63c84186efd1fd31bb5ef8f38beb5c6dcbaabe1cb1e0cb672163bc807',
  // #2184: a field row carries one status (ACTIVE, WITHDRAWN, ELIMINATED, DISQUALIFIED) in place of isActive and inactiveReason.
  12: 'f766fdcc93bc2d4505daefa55d5bed66231488e3dd0a086ed4f08b250849c8bf',
};

const LEADERBOARD_RESPONSES = ['ContestLeaderboardResponse', 'BracketLeaderboardResponse', 'PickEmLeaderboardResponse', 'SurvivorLeaderboardResponse'];

/** Keys that word a schema rather than shape it: changing one changes nothing a stored board holds. */
const WORDING_KEYS = new Set(['description', 'title', 'example', 'examples']);

/**
 * The schema with its wording dropped and its keys sorted, so only a change of shape changes it.
 * The names under `properties` are fields, kept whatever they are called: a field named `title` is shape.
 */
function shapeOf(schema: unknown, isPropertyMap = false): unknown {
  if (Array.isArray(schema)) return schema.map((item) => shapeOf(item));
  if (schema === null || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema)
    .filter(([key]) => isPropertyMap || !WORDING_KEYS.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, isPropertyMap ? shapeOf(value) : shapeOf(value, key === 'properties')]));
}

describe('LEADERBOARD_BOARD_FORMAT', () => {
  it('names the shape of the four leaderboard responses in the contract, so changing one without bumping the format fails here', () => {
    const openapi = JSON.parse(readFileSync(join(__dirname, '../../../packages/shared/generated/openapi.json'), 'utf8')) as {
      components: { schemas: Record<string, unknown> };
    };
    const shapes = LEADERBOARD_RESPONSES.map((name) => {
      const schema = openapi.components.schemas[name];
      if (schema === undefined) throw new Error(`The contract has no ${name}`);
      return [name, shapeOf(schema)];
    });
    const hash = createHash('sha256').update(JSON.stringify(shapes)).digest('hex');

    expect({ format: LEADERBOARD_BOARD_FORMAT, hash }).toEqual({ format: LEADERBOARD_BOARD_FORMAT, hash: SHAPE_HASH_BY_FORMAT[LEADERBOARD_BOARD_FORMAT] });
  });
});
