/**
 * Defect-proof structural assertions for pool-master-rop.78.3 — provider
 * adapter normalization.
 *
 * On origin/main, two adapters synthesized per-round golf strokes from
 * `(par + scoreToPar)` using a notional par of 72 because the
 * `GolfRoundUpdate` schema required `strokes: number`. This produced
 * fabricated strokes data that the bus boundary then upserted into
 * `SportEventParticipantGolfRound` rows. These assertions fail against
 * origin/main and pass on this branch, where:
 *   - the schema accepts `strokes: number | null`;
 *   - both mock + ESPN-leaderboard adapters emit `strokes: null`;
 *   - the persistence path skips rounds with null strokes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as liveScoreDto from '@poolmaster/shared/dto/live-score.dto';

const adapterPaths = [
  resolve(__dirname, '../../../packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter.ts'),
  resolve(__dirname, '../../../packages/core-api/src/modules/ingestion/adapters/pga-tour-adapter.ts'),
];

describe('pool-master-rop.78.3 — no synthetic golf strokes', () => {
  it('GolfRoundUpdate.strokes is nullable in the schema', () => {
    const parsed = liveScoreDto.GolfRoundUpdateSchema.safeParse({
      participantExternalId: 'rory',
      round: 1,
      strokes: null,
      scoreToPar: -2,
      status: 'IN_PROGRESS',
    });
    expect(parsed.success).toBe(true);
  });

  it('LiveScoreResult.GOLF arm requires externalEventId for event scoping', () => {
    const parsed = liveScoreDto.LiveScoreResultSchema.safeParse({
      category: 'GOLF',
      // externalEventId is intentionally omitted
      rounds: [],
    });
    expect(parsed.success).toBe(false);
  });

  it.each(adapterPaths)('%s does not synthesize strokes from (par + scoreToPar)', (adapterPath) => {
    const src = readFileSync(adapterPath, 'utf8');
    // The pre-fix synthesis was `strokes: 72 + ...`. Any literal of the
    // form `strokes: <int> +` indicates regressed synthesis.
    expect(src).not.toMatch(/strokes:\s*\d+\s*\+/);
  });
});
