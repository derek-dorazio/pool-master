/**
 * ContestEntryPickGolfRosterContribution mapper — Prisma row →
 * ContestEntryPickGolfRosterContributionDto per plans/117 §8.1.
 *
 * Pure projection. The `contribution` column arrives as a Prisma Decimal
 * (Decimal(12, 4)); the only transformation is JSON-serializable coercion
 * to a plain number.
 */

import type { ContestEntryPickGolfRosterContributionDto } from '@poolmaster/shared/dto';

interface DecimalLike {
  toNumber(): number;
}

function isDecimalLike(value: unknown): value is DecimalLike {
  return typeof value === 'object' && value !== null && typeof (value as DecimalLike).toNumber === 'function';
}

export interface ContestEntryPickGolfRosterContributionRow {
  id: string;
  contestEntryPickId: string;
  round: number;
  strokes: number;
  scoreToPar: number;
  contribution: DecimalLike | number;
  contributedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function mapContestEntryPickGolfRosterContributionToDto(
  row: ContestEntryPickGolfRosterContributionRow,
): ContestEntryPickGolfRosterContributionDto {
  let contribution: number;
  if (typeof row.contribution === 'number') {
    contribution = row.contribution;
  } else if (isDecimalLike(row.contribution)) {
    contribution = row.contribution.toNumber();
  } else {
    contribution = Number(row.contribution);
  }

  return {
    id: row.id,
    contestEntryPickId: row.contestEntryPickId,
    round: row.round,
    strokes: row.strokes,
    scoreToPar: row.scoreToPar,
    contribution,
    contributedAt: row.contributedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
