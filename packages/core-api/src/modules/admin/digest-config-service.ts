/**
 * DigestConfigService — platform-wide weekly digest template configuration.
 *
 * Controls the subject, header, footer, content toggles, schedule, and
 * enabled state for the weekly league digest email.
 */

export interface DigestTemplateConfig {
  subjectTemplate: string;
  headerTemplate: string;
  footerTemplate: string;
  includeStandings: boolean;
  includeHighlights: boolean;
  includeUpcomingEvents: boolean;
  lookbackDays: number;
  sendDay: string;
  sendHourUtc: number;
  enabled: boolean;
}

const HARDCODED_DEFAULTS: DigestTemplateConfig = {
  subjectTemplate: 'Weekly Recap — {{league_name}}',
  headerTemplate: "Here's what happened this week in {{league_name}}",
  footerTemplate: 'See you next week! — PoolMaster',
  includeStandings: true,
  includeHighlights: true,
  includeUpcomingEvents: true,
  lookbackDays: 7,
  sendDay: 'MONDAY',
  sendHourUtc: 14,
  enabled: true,
};

const MOCK_STANDINGS = [
  { contestName: 'NFL Pick\'em Week 12', top3: [
    { entryName: 'The Underdogs', score: 87, rank: 1 },
    { entryName: 'Gridiron Gurus', score: 82, rank: 2 },
    { entryName: 'Sunday Funday', score: 79, rank: 3 },
  ]},
];

const MOCK_HIGHLIGHTS = [
  'The Underdogs clinched the weekly prize with 87 points',
  'League record: 14 members submitted picks before the early deadline',
];

const MOCK_UPCOMING = [
  { event: 'NFL Week 13 locks', date: 'Sunday 1:00 PM ET' },
  { event: 'Trade deadline', date: 'Wednesday 11:59 PM ET' },
];

export class DigestConfigService {
  private config: DigestTemplateConfig = { ...HARDCODED_DEFAULTS };

  getConfig(): DigestTemplateConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<DigestTemplateConfig>): DigestTemplateConfig {
    this.config = { ...this.config, ...updates };
    return { ...this.config };
  }

  resetDefaults(): DigestTemplateConfig {
    this.config = { ...HARDCODED_DEFAULTS };
    return { ...this.config };
  }

  previewDigest(leagueId?: string): string {
    const leagueName = leagueId ? `League ${leagueId}` : 'Demo League';
    const cfg = this.config;

    const subject = cfg.subjectTemplate.replace('{{league_name}}', leagueName);
    const header = cfg.headerTemplate.replace('{{league_name}}', leagueName);

    const sections: string[] = [
      `Subject: ${subject}`,
      '',
      header,
      '',
    ];

    if (cfg.includeStandings) {
      sections.push('--- Standings ---');
      for (const contest of MOCK_STANDINGS) {
        sections.push(`  ${contest.contestName}:`);
        for (const entry of contest.top3) {
          sections.push(`    #${entry.rank} ${entry.entryName} — ${entry.score} pts`);
        }
      }
      sections.push('');
    }

    if (cfg.includeHighlights) {
      sections.push('--- Highlights ---');
      for (const h of MOCK_HIGHLIGHTS) {
        sections.push(`  * ${h}`);
      }
      sections.push('');
    }

    if (cfg.includeUpcomingEvents) {
      sections.push('--- Upcoming ---');
      for (const u of MOCK_UPCOMING) {
        sections.push(`  ${u.event} — ${u.date}`);
      }
      sections.push('');
    }

    sections.push(cfg.footerTemplate);

    return sections.join('\n');
  }
}
