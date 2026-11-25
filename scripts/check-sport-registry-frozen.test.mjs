import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareWithBaseline, definitionFields, exportedNames, registryEntries } from './check-sport-registry-frozen.mjs';

const DEFINITION = `
export interface SportNoun { one: string; }
export interface SportDefinition {
  sport: Sport;
  /** A comment: with a colon. */
  pickEm?: SportPickEm;
  roundLabel: (roundNumber: number, roundCount: number) => string;
  nested: {
    inner: number;
  };
}
export const X = 1;
`;

describe('check-sport-registry-frozen', () => {
  it('lists the top-level SportDefinition fields, optional ones included, but not fields of nested types or comments', () => {
    assert.deepEqual(definitionFields(DEFINITION), ['sport', 'pickEm', 'roundLabel', 'nested']);
  });

  it('lists every name a registry file exports', () => {
    assert.deepEqual(exportedNames('export const A = 1;\nexport function b() {}\nexport type C = 1;\nconst d = 2;'), ['A', 'b', 'C']);
  });

  it('lists names in a local export list and a default export, but not a re-export from another file', () => {
    const text = "const a = 1;\nconst b = 2;\nexport { a, b as B };\nexport type { T } from './t';\nexport { c } from './c';\nexport default a;";
    assert.deepEqual(exportedNames(text), ['a', 'B', 'default']);
  });

  it('names fields from the definition file and exports from every file', () => {
    assert.deepEqual(registryEntries({ 'sport-definition.ts': DEFINITION, 'golf.ts': 'export const GOLF = {};' }), [
      'export:golf.ts:GOLF',
      'export:sport-definition.ts:SportDefinition',
      'export:sport-definition.ts:SportNoun',
      'export:sport-definition.ts:X',
      'field:nested',
      'field:pickEm',
      'field:roundLabel',
      'field:sport',
    ]);
  });

  it('fails a new field or export, and asks for a removed one to leave the baseline', () => {
    const { added, removed } = compareWithBaseline(['field:a', 'field:new'], ['field:a', 'field:gone']);
    assert.deepEqual(added, ['field:new']);
    assert.deepEqual(removed, ['field:gone']);
  });
});
