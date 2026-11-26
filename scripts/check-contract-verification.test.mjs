import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateContractVerification,
  findCheckedSchemas,
  readResponseSchemaNames,
} from './check-contract-verification.mjs';

const dtoFile = `
export const SportEventBracketResponseSchema = z.object({ matches: z.array(MatchSchema) });
export const SportEventRoundMatchResponseSchema = z.object({ match: MatchSchema });
export const LoadSportEventBracketRequestSchema = z.object({ matches: z.array(MatchSchema) });
const InternalResponseSchema = z.object({});
`;

const schemas = readResponseSchemaNames(dtoFile).map((name) => ({ name, file: 'packages/shared/dto/bracket.dto.ts' }));

describe('check-contract-verification', () => {
  it('reads only the exported response schemas, not request or unexported ones', () => {
    assert.deepEqual(schemas.map((schema) => schema.name), ['SportEventBracketResponseSchema', 'SportEventRoundMatchResponseSchema']);
  });

  it('counts a safeParse, a parse or an expectMatchesSchema call as a check, and an import alone as none', () => {
    const names = ['SportEventBracketResponseSchema', 'SportEventRoundMatchResponseSchema'];
    assert.deepEqual([...findCheckedSchemas(names, ['expect(SportEventBracketResponseSchema.safeParse(res.json()).success).toBe(true);'])], ['SportEventBracketResponseSchema']);
    assert.deepEqual([...findCheckedSchemas(names, ['const board = SportEventRoundMatchResponseSchema.parse(body);'])], ['SportEventRoundMatchResponseSchema']);
    assert.deepEqual([...findCheckedSchemas(names, ['expectMatchesSchema(\n  SportEventRoundMatchResponseSchema,\n  moved.data)'])], ['SportEventRoundMatchResponseSchema']);
    assert.deepEqual([...findCheckedSchemas(names, ["import { SportEventBracketResponseSchema } from '@poolmaster/shared/dto';"])], []);
  });

  it('does not count a check of a schema whose name merely ends the same way', () => {
    assert.deepEqual([...findCheckedSchemas(['MatchResponseSchema'], ['SportEventRoundMatchResponseSchema.safeParse(body)'])], []);
  });

  it('fails a response schema that no test checks and the gap list does not name', () => {
    const findings = evaluateContractVerification({ schemas, checked: new Set(['SportEventBracketResponseSchema']), gaps: [] });
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /SportEventRoundMatchResponseSchema is never checked/);
  });

  it('passes when every schema is checked or listed as a known gap', () => {
    const findings = evaluateContractVerification({
      schemas,
      checked: new Set(['SportEventBracketResponseSchema']),
      gaps: [{ schema: 'SportEventRoundMatchResponseSchema', endpoints: 'PATCH /bracket/rounds/:roundNumber/matches/:matchNumber' }],
    });
    assert.deepEqual(findings, []);
  });

  it('fails a gap entry once its schema is checked, and one that names no exported schema, so the list only shrinks', () => {
    const findings = evaluateContractVerification({
      schemas,
      checked: new Set(['SportEventBracketResponseSchema', 'SportEventRoundMatchResponseSchema']),
      gaps: [
        { schema: 'SportEventRoundMatchResponseSchema', endpoints: 'PATCH /bracket/rounds/:roundNumber/matches/:matchNumber' },
        { schema: 'RetiredResponseSchema', endpoints: 'GET /gone' },
      ],
    });
    assert.deepEqual(findings.map((finding) => finding.message), [
      'SportEventRoundMatchResponseSchema is checked now; delete its entry.',
      'RetiredResponseSchema is listed but is not an exported response schema; delete its entry.',
    ]);
  });

  it('fails a gap list longer than the ceiling, so a new schema cannot be parked on it', () => {
    const findings = evaluateContractVerification({
      schemas,
      checked: new Set(),
      gaps: [
        { schema: 'SportEventBracketResponseSchema', endpoints: 'GET /bracket' },
        { schema: 'SportEventRoundMatchResponseSchema', endpoints: 'PATCH /bracket/rounds/:roundNumber/matches/:matchNumber' },
      ],
      ceiling: 1,
    });
    assert.deepEqual(findings.map((finding) => finding.message), [
      '2 gaps are listed, over the ceiling of 1. A new response schema gets its contract-verification case, not a gap entry.',
    ]);
  });
});
