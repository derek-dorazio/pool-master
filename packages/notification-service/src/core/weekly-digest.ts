/**
 * WeeklyDigest — generates and sends weekly league summary emails.
 */

import type { PrismaClient } from '@prisma/client';
import type { Channels } from '../channels/channel-factory';
import { renderTemplate } from './template-renderer';

export interface DigestContent {
  leagueId: string;
  leagueName: string;
  periodStart: Date;
  periodEnd: Date;
  standings: Array<{
    contestName: string;
    top3: Array<{ entryName: string; score: number; rank: number }>;
  }>;
  highlights: string[];
  upcoming: Array<{ event: string; date: string }>;
}

const DIGEST_SUBJECT = 'Weekly Recap — {{league_name}}';
const DIGEST_TEXT = `Weekly Recap for {{league_name}} ({{period}})

{{standings_text}}

Highlights:
{{highlights_text}}

Upcoming:
{{upcoming_text}}

— PoolMaster`;

export class WeeklyDigestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly channels: Channels,
  ) {}

  /** Generates and sends the weekly digest for a league. */
  async sendDigest(leagueId: string): Promise<{ sent: number; skipped: number }> {
    const league = await this.prisma.league.findUnique({ where: { id: leagueId } });
    if (!league) return { sent: 0, skipped: 0 };

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get recent contest results
    const recentResults = await this.prisma.contestResult.findMany({
      where: { leagueId, closedAt: { gte: weekAgo } },
      orderBy: { finalRank: 'asc' },
    });

    // Get active contest standings
    const activeContests = await this.prisma.contest.findMany({
      where: { leagueId, status: { in: ['ACTIVE', 'LOCKED'] } },
      include: {
        standings: { orderBy: { rank: 'asc' }, take: 3 },
        entries: true,
      },
    });

    // Build standings text
    const standingsText = activeContests.map((c) => {
      const top3 = c.standings.map((s) => {
        const entry = c.entries.find((e) => e.id === s.entryId);
        return `  #${s.rank} ${entry?.name ?? 'Unknown'} — ${s.totalScore} pts`;
      }).join('\n');
      return `${c.name}:\n${top3}`;
    }).join('\n\n');

    // Build highlights
    const highlights: string[] = [];
    for (const result of recentResults.filter((r) => r.isWinner)) {
      highlights.push(`${result.contestName ?? 'Contest'} won with ${result.totalScore} points`);
    }

    // Build upcoming text
    const upcomingText = 'Check the app for upcoming events';

    const period = `${weekAgo.toLocaleDateString()} — ${now.toLocaleDateString()}`;
    const templateData = {
      league_name: league.name,
      period,
      standings_text: standingsText || 'No active contests this week',
      highlights_text: highlights.length > 0 ? highlights.map((h) => `• ${h}`).join('\n') : 'No highlights this week',
      upcoming_text: upcomingText,
    };

    const subject = renderTemplate(DIGEST_SUBJECT, templateData);
    const text = renderTemplate(DIGEST_TEXT, templateData);

    // Send to all league members who have email digest enabled
    const memberships = await this.prisma.leagueMembership.findMany({
      where: { leagueId },
      include: { user: true },
    });

    let sent = 0;
    let skipped = 0;

    for (const membership of memberships) {
      const prefs = await this.prisma.notificationPreference.findUnique({
        where: { userId: membership.userId },
      });

      // Check if user has league email enabled (default: yes for digests)
      const categories = prefs?.categoryPreferences as Record<string, { enabled: boolean; channels: { email: boolean } }> | undefined;
      const leaguePrefs = categories?.LEAGUE;
      if (leaguePrefs && (!leaguePrefs.enabled || !leaguePrefs.channels.email)) {
        skipped++;
        continue;
      }

      await this.channels.email.sendToUser(membership.user.email, subject, text);
      sent++;
    }

    return { sent, skipped };
  }
}
