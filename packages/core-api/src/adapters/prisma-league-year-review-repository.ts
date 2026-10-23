/**
 * Prisma adapter for the LeagueYearReviewRepository port (#872 slice 4).
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type { LeagueYearReviewRepository } from '@poolmaster/shared/db';
import type { LeagueYearReview } from '@poolmaster/shared/domain';

const REVIEW_SELECT = { leagueId: true, year: true, sentByUserId: true, sentAt: true } as const;

export class PrismaLeagueYearReviewRepository implements LeagueYearReviewRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByLeagueYear(leagueId: string, year: number): Promise<LeagueYearReview | null> {
    return this.prisma.leagueYearReview.findUnique({ where: { leagueId_year: { leagueId, year } }, select: REVIEW_SELECT });
  }

  async create(review: Omit<LeagueYearReview, 'sentAt'>): Promise<LeagueYearReview | null> {
    try {
      return await this.prisma.leagueYearReview.create({ data: review, select: REVIEW_SELECT });
    } catch (error) {
      // Two presses racing: the unique key lets one through.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }
}
