/**
 * Defect-proof structural assertions for pool-master-rop.78.6 — contest-entry
 * pick unification.
 *
 * These tests fail against origin/main (where the dual RosterPick/EntryPick
 * shapes co-existed and the shared port advertised a caller-supplied
 * `ContestEntryPickRepository.create` write path) and pass on this branch
 * after unification. They are the failing-test-before-fix proof that the
 * substrate now has exactly one canonical pick shape and exactly one write
 * path.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as sharedDto from '@poolmaster/shared/dto';

describe('pool-master-rop.78.6 — ContestEntryPick canonical shape', () => {
  it('exposes ContestEntryPickDtoSchema as the canonical raw-row DTO', () => {
    expect(sharedDto).toHaveProperty('ContestEntryPickDtoSchema');
  });

  it('uses pickId (not rosterPickId) on the participant detail shape', () => {
    const shape = sharedDto.ContestEntryParticipantDetailDtoSchema.shape;
    expect(shape).toHaveProperty('pickId');
    expect(shape).not.toHaveProperty('rosterPickId');
  });

  it('does not re-export the dropped RosterPickDto symbol', () => {
    expect(sharedDto).not.toHaveProperty('RosterPickDto');
    expect(sharedDto).not.toHaveProperty('RosterPickDtoSchema');
  });

  it('does not advertise a caller-supplied ContestEntryPickRepository write port', () => {
    // Type-only export: read source so the assertion fires at unit-test time
    // rather than relying on tsc to catch a missing port (which would only
    // surface if some caller still depended on the dropped interface).
    const portsSrc = readFileSync(
      resolve(__dirname, '../../../packages/shared/db/ports.ts'),
      'utf8',
    );
    expect(portsSrc).not.toMatch(/ContestEntryPickRepository/);
  });

  it('does not contain rosterPickId in the generated OpenAPI types', () => {
    const apiTypesSrc = readFileSync(
      resolve(__dirname, '../../../packages/shared/generated/api-types.ts'),
      'utf8',
    );
    expect(apiTypesSrc).not.toMatch(/rosterPickId/);
  });
});
