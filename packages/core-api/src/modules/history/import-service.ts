/**
 * ImportService — manual season import for migrating leagues from other platforms.
 *
 * Validates and imports historical contest results, creating ContestResult
 * records and optionally new league memberships for unrecognised members.
 */

import type { PrismaClient } from '@prisma/client';

export interface SeasonImportData {
  season: string;
  year: number;
  sport: string;
  contests: ImportedContest[];
}

export interface ImportedContest {
  name: string;
  contestType: string;
  startedAt?: string;
  endedAt?: string;
  results: ImportedResult[];
}

export interface ImportedResult {
  memberEmail: string;
  memberName: string;
  finalRank: number;
  totalScore: number;
  prizeAmount?: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  memberMatches: { email: string; matched: boolean; membershipId?: string }[];
}

export interface ImportResult {
  contestsImported: number;
  resultsImported: number;
  membersMatched: number;
  membersCreated: number;
  warnings: string[];
}

export class ImportService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Validate import data without executing. */
  async validateImport(leagueId: string, data: SeasonImportData): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate league exists
    const league = await this.prisma.league.findUnique({ where: { id: leagueId } });
    if (!league) {
      return { isValid: false, errors: ['League not found'], warnings: [], memberMatches: [] };
    }

    if (!data.season || !data.year || !data.sport) {
      errors.push('Missing required fields: season, year, sport');
    }

    if (!data.contests || data.contests.length === 0) {
      errors.push('No contests provided');
    }

    // Check for duplicate contest names
    const contestNames = data.contests.map((c) => c.name);
    const dupes = contestNames.filter((n, i) => contestNames.indexOf(n) !== i);
    if (dupes.length > 0) {
      warnings.push(`Duplicate contest names: ${dupes.join(', ')}`);
    }

    // Match members by email
    const allEmails = [...new Set(data.contests.flatMap((c) => c.results.map((r) => r.memberEmail)))];
    const existingUsers = await this.prisma.user.findMany({
      where: { email: { in: allEmails } },
    });
    const emailToUser = new Map(existingUsers.map((u) => [u.email, u]));

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });
    const userIdToMembership = new Map(memberships.map((m) => [m.userId, m]));

    const memberMatches = allEmails.map((email) => {
      const user = emailToUser.get(email);
      if (!user) {
        return { email, matched: false };
      }
      const membership = userIdToMembership.get(user.id);
      if (!membership) {
        warnings.push(`User ${email} exists but is not a member of this league — will be added`);
        return { email, matched: false };
      }
      return { email, matched: true, membershipId: membership.id };
    });

    // Validate results in each contest
    for (const contest of data.contests) {
      if (!contest.name) {
        errors.push('Contest missing name');
      }
      if (!contest.results || contest.results.length === 0) {
        errors.push(`Contest "${contest.name}" has no results`);
      }
      for (const result of contest.results) {
        if (result.finalRank < 1) {
          errors.push(`Invalid rank ${result.finalRank} for ${result.memberEmail} in "${contest.name}"`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      memberMatches,
    };
  }

  /** Execute the import, creating ContestResult records. */
  async executeImport(
    leagueId: string,
    data: SeasonImportData,
    importedBy: string,
  ): Promise<ImportResult> {
    const validation = await this.validateImport(leagueId, data);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
    }

    const warnings: string[] = [...validation.warnings];
    let contestsImported = 0;
    let resultsImported = 0;
    let membersMatched = 0;
    let membersCreated = 0;

    // Resolve or create season
    const league = await this.prisma.league.findUnique({ where: { id: leagueId } });
    if (!league) throw new Error('League not found');

    let season = await this.prisma.season.findFirst({
      where: { name: data.season, year: data.year },
    });
    if (!season) {
      // Find or create a sport record for the import
      let sport = await this.prisma.sport.findFirst({ where: { name: data.sport } });
      if (!sport) {
        sport = await this.prisma.sport.create({
          data: { name: data.sport, participantType: 'PLAYER' },
        });
      }
      season = await this.prisma.season.create({
        data: {
          name: data.season,
          year: data.year,
          sportId: sport.id,
          tenantId: league.tenantId,
          startDate: new Date(data.year, 0, 1),
          endDate: new Date(data.year, 11, 31),
        },
      });
    }

    // Build email -> membershipId mapping
    const membershipMap = await this.resolveMemberships(
      leagueId,
      data,
      (matched) => { membersMatched += matched; },
      (created) => { membersCreated += created; },
      warnings,
    );

    // Import each contest
    for (const contest of data.contests) {
      const numEntries = contest.results.length;
      const now = new Date();

      // Create a placeholder contest for historical reference
      // Use type assertion because the Prisma client may not yet reflect
      // recently-added schema fields (sport, isImported, importedBy, etc.)
      const createdContest = await this.prisma.contest.create({
        data: {
          leagueId,
          seasonId: season.id,
          name: contest.name,
          contestType: contest.contestType,
          selectionType: 'IMPORTED',
          scoringEngine: 'IMPORTED',
          sport: data.sport,
          status: 'COMPLETED',
          startDate: contest.startedAt ? new Date(contest.startedAt) : now,
          endDate: contest.endedAt ? new Date(contest.endedAt) : now,
          isImported: true,
          importedBy,
        } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      });

      // Create ContestResult for each result
      for (const result of contest.results) {
        const membershipId = membershipMap.get(result.memberEmail);
        if (!membershipId) {
          warnings.push(`Skipped result for ${result.memberEmail} — could not resolve membership`);
          continue;
        }

        const percentileRank = numEntries > 1
          ? ((numEntries - result.finalRank) / (numEntries - 1)) * 100
          : 100;

        await this.prisma.contestResult.create({
          data: {
            contestId: createdContest.id,
            entryId: membershipId, // use membership as entry proxy for imports
            finalRank: result.finalRank,
            totalScore: result.totalScore,
            prizeAmount: result.prizeAmount ?? null,
            leagueId,
            seasonId: season.id,
            leagueMembershipId: membershipId,
            contestName: contest.name,
            contestType: contest.contestType,
            sport: data.sport,
            numEntries,
            startedAt: contest.startedAt ? new Date(contest.startedAt) : null,
            endedAt: contest.endedAt ? new Date(contest.endedAt) : null,
            isWinner: result.finalRank === 1,
            isPaidPosition: (result.prizeAmount ?? 0) > 0,
            percentileRank,
            pointsBehindWinner: 0,
            pointsBehindNext: 0,
            closedAt: contest.endedAt ? new Date(contest.endedAt) : now,
          },
        });
        resultsImported++;
      }
      contestsImported++;
    }

    return { contestsImported, resultsImported, membersMatched, membersCreated, warnings };
  }

  /** Resolve emails to membership IDs, creating users/memberships as needed. */
  private async resolveMemberships(
    leagueId: string,
    data: SeasonImportData,
    onMatched: (count: number) => void,
    onCreated: (count: number) => void,
    warnings: string[],
  ): Promise<Map<string, string>> {
    const allEmails = [...new Set(data.contests.flatMap((c) => c.results.map((r) => r.memberEmail)))];
    const emailNameMap = new Map<string, string>();
    for (const contest of data.contests) {
      for (const r of contest.results) {
        emailNameMap.set(r.memberEmail, r.memberName);
      }
    }

    const result = new Map<string, string>();

    for (const email of allEmails) {
      // Try to find existing user
      let user = await this.prisma.user.findUnique({ where: { email } });

      if (!user) {
        // Create stub user for historical import
        user = await this.prisma.user.create({
          data: {
            email,
            displayName: emailNameMap.get(email) ?? email,
            authProvider: 'IMPORTED',
            tenantId: (await this.prisma.league.findUnique({ where: { id: leagueId } }))!.tenantId,
          },
        });
        onCreated(1);
        warnings.push(`Created stub user for ${email}`);
      } else {
        onMatched(1);
      }

      // Find or create membership
      let membership = await this.prisma.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId, userId: user.id } },
      });

      if (!membership) {
        membership = await this.prisma.leagueMembership.create({
          data: { leagueId, userId: user.id, role: 'MANAGER' },
        });
        warnings.push(`Created league membership for ${email}`);
      }

      result.set(email, membership.id);
    }

    return result;
  }
}
