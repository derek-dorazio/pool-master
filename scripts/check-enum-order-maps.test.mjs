import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findEnumOrderMaps, sharedEnumNames } from './check-enum-order-maps.mjs';

const ENUMS = ['Sport', 'ContestStatus', 'CupWeight'];

describe('check-enum-order-maps (#1841)', () => {
  it('reads the enum names enums.ts declares as const objects', () => {
    assert.deepEqual(sharedEnumNames("export const Sport = {\n  GOLF: 'GOLF',\n} as const;\nexport type Sport = string;\n"), ['Sport']);
  });

  it('flags a map whose name says it is a rank or an order, whatever its numbers', () => {
    const source = 'export const SPORT_POPULARITY_RANK: Readonly<Record<Sport, number>> = {\n  [Sport.GOLF]: 6,\n};';
    assert.deepEqual(findEnumOrderMaps(source, ENUMS), [{ name: 'SPORT_POPULARITY_RANK', enumName: 'Sport', line: 1 }]);
    assert.equal(findEnumOrderMaps('const stageIndex: Partial<Record<ContestStatus, number>> = {};', ENUMS).length, 1);
  });

  it('flags a map of any name whose literal gives the values the places 0, 1, 2 in turn', () => {
    const source = 'const seen: Record<ContestStatus, number> = {\n  [ContestStatus.OPEN]: 1,\n  [ContestStatus.DRAFT]: 0,\n  [ContestStatus.ACTIVE]: 2,\n};';
    assert.equal(findEnumOrderMaps(source, ENUMS).length, 1);
  });

  it('passes a map of real quantities, such as a cup weight, and a map over an enum that is not shared', () => {
    const weights = 'const WEIGHT_TENTHS: Record<CupWeight, number> = {\n  [CupWeight.NORMAL]: 10,\n  [CupWeight.BONUS]: 15,\n};';
    assert.deepEqual(findEnumOrderMaps(weights, ENUMS), []);
    assert.deepEqual(findEnumOrderMaps('const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1 };', ENUMS), []);
  });

  it('skips comment lines, so a note about the old map does not count', () => {
    assert.deepEqual(findEnumOrderMaps('// const RANK: Record<Sport, number> = {};', ENUMS), []);
  });
});
