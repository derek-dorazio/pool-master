/**
 * HistoryExportService — exports league and member history as JSON or CSV.
 *
 * Supports full league export (all seasons, contests, results, records)
 * and individual member history export.
 */

import type { PrismaClient } from '@prisma/client';

export interface LeagueExportData {
  league: { name: string; sport: string; createdAt: string };
  members: { name: string; email: string; role: string; joinedAt: string }[];
  seasons: {
    season: string;
    contests: {
      name: string;
      type: string;
      results: { memberName: string; rank: number; score: number; prize?: number }[];
    }[];
  }[];
  records: { category: string; holder: string; value: number; contestName: string; date: string }[];
}

export interface MemberExportData {
  member: { name: string; email: string };
  contestResults: {
    contestName: string;
    sport: string;
    season: string;
    rank: number;
    score: number;
    prize?: number;
    date: string;
  }[];
  trophies: { label: string; season: string; date: string }[];
  stats: { totalContests: number; wins: number; totalPrize: number; winRate: number };
}

export class HistoryExportService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Export all history for a league as JSON. */
  async exportLeagueJson(leagueId: string): Promise<LeagueExportData> {
    const league = await this.prisma.league.findUnique({ where: { id: leagueId } });
    if (!league) throw new Error('League not found');

    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });

    const results = await this.prisma.contestResult.findMany({
      where: { leagueId },
      orderBy: { closedAt: 'asc' },
    });

    const records = await this.prisma.leagueRecord.findMany({
      where: { leagueId },
    });

    const memberNameMap = new Map(memberships.map((m) => [m.id, m.user.displayName]));

    // Group results by season then by contest
    const seasonContests = new Map<string, Map<string, typeof results>>();
    for (const r of results) {
      const seasonKey = r.seasonId ?? 'unknown';
      let contests = seasonContests.get(seasonKey);
      if (!contests) {
        contests = new Map();
        seasonContests.set(seasonKey, contests);
      }
      const contestResults = contests.get(r.contestId) ?? [];
      contestResults.push(r);
      contests.set(r.contestId, contestResults);
    }

    // Resolve season names
    const seasonIds = [...seasonContests.keys()].filter((k) => k !== 'unknown');
    const seasonSummaries = await this.prisma.leagueSeasonSummary.findMany({
      where: { leagueId },
    });
    const seasonNameMap = new Map(seasonSummaries.map((s) => [s.seasonId ?? '', s.seasonName]));

    const seasons = Array.from(seasonContests.entries()).map(([seasonId, contests]) => ({
      season: seasonNameMap.get(seasonId) ?? seasonId,
      contests: Array.from(contests.entries()).map(([_contestId, contestResults]) => ({
        name: contestResults[0].contestName ?? '',
        type: contestResults[0].contestType ?? '',
        results: contestResults
          .sort((a, b) => a.finalRank - b.finalRank)
          .map((r) => ({
            memberName: memberNameMap.get(r.leagueMembershipId ?? '') ?? '',
            rank: r.finalRank,
            score: r.totalScore,
            prize: r.prizeAmount ?? undefined,
          })),
      })),
    }));

    return {
      league: {
        name: league.name,
        sport: (league.settings as Record<string, unknown>)?.sport as string ?? '',
        createdAt: league.createdAt.toISOString(),
      },
      members: memberships.map((m) => ({
        name: m.user.displayName,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
      seasons,
      records: records.map((r) => ({
        category: r.category,
        holder: r.heldByMemberName,
        value: r.recordValue,
        contestName: '',
        date: r.setAt.toISOString(),
      })),
    };
  }

  /** Export all history for a league as CSV (array of named CSV strings). */
  async exportLeagueCsv(leagueId: string): Promise<{ filename: string; csvContent: string }[]> {
    const data = await this.exportLeagueJson(leagueId);
    const csvFiles: { filename: string; csvContent: string }[] = [];

    // Members CSV
    const membersHeader = 'Name,Email,Role,Joined At';
    const membersRows = data.members.map(
      (m) => `${escapeCsv(m.name)},${escapeCsv(m.email)},${escapeCsv(m.role)},${escapeCsv(m.joinedAt)}`,
    );
    csvFiles.push({ filename: 'members.csv', csvContent: [membersHeader, ...membersRows].join('\n') });

    // Results CSV
    const resultsHeader = 'Season,Contest,Type,Member,Rank,Score,Prize';
    const resultsRows: string[] = [];
    for (const season of data.seasons) {
      for (const contest of season.contests) {
        for (const result of contest.results) {
          resultsRows.push(
            `${escapeCsv(season.season)},${escapeCsv(contest.name)},${escapeCsv(contest.type)},` +
            `${escapeCsv(result.memberName)},${result.rank},${result.score},${result.prize ?? ''}`,
          );
        }
      }
    }
    csvFiles.push({ filename: 'results.csv', csvContent: [resultsHeader, ...resultsRows].join('\n') });

    // Records CSV
    const recordsHeader = 'Category,Holder,Value,Date';
    const recordsRows = data.records.map(
      (r) => `${escapeCsv(r.category)},${escapeCsv(r.holder)},${r.value},${escapeCsv(r.date)}`,
    );
    csvFiles.push({ filename: 'records.csv', csvContent: [recordsHeader, ...recordsRows].join('\n') });

    return csvFiles;
  }

  /** Export a member's personal history. */
  async exportMemberHistory(memberId: string): Promise<MemberExportData> {
    const membership = await this.prisma.leagueMembership.findUnique({
      where: { id: memberId },
      include: { user: true },
    });
    if (!membership) throw new Error('Member not found');

    const results = await this.prisma.contestResult.findMany({
      where: { leagueMembershipId: memberId },
      orderBy: { closedAt: 'desc' },
    });

    const trophies = await this.prisma.trophy.findMany({
      where: { leagueMembershipId: memberId },
      orderBy: { awardedAt: 'desc' },
    });

    // Resolve season names
    const seasonIds = [...new Set(results.map((r) => r.seasonId).filter(Boolean))] as string[];
    const seasonSummaries = seasonIds.length > 0
      ? await this.prisma.leagueSeasonSummary.findMany({
          where: { seasonId: { in: seasonIds } },
        })
      : [];
    const seasonNameMap = new Map(seasonSummaries.map((s) => [s.seasonId ?? '', s.seasonName]));

    const totalContests = results.length;
    const wins = results.filter((r) => r.isWinner).length;
    const totalPrize = results.reduce((s, r) => s + (r.prizeAmount ?? 0), 0);

    return {
      member: {
        name: membership.user.displayName,
        email: membership.user.email,
      },
      contestResults: results.map((r) => ({
        contestName: r.contestName ?? '',
        sport: r.sport ?? '',
        season: seasonNameMap.get(r.seasonId ?? '') ?? '',
        rank: r.finalRank,
        score: r.totalScore,
        prize: r.prizeAmount ?? undefined,
        date: r.closedAt?.toISOString() ?? '',
      })),
      trophies: trophies.map((t) => ({
        label: t.label,
        season: t.seasonId ?? '',
        date: t.awardedAt.toISOString(),
      })),
      stats: {
        totalContests,
        wins,
        totalPrize,
        winRate: totalContests > 0 ? Math.round((wins / totalContests) * 1000) / 1000 : 0,
      },
    };
  }
}

/** Escape a value for CSV output. */
function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
