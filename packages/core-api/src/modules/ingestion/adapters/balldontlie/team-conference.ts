import type { ProviderTeamConference } from '../../core/provider-interface';

/**
 * A team's conference and division as the feed sends them (#2052), for spreading onto a team: none
 * when the feed names no conference (a blank, or a franchise in none), and no division when it
 * names none. The codes are kept exactly as sent; the league's conference provider mappings say
 * which conference each is.
 */
export function teamConference(
  conference: string | number | null | undefined,
  division?: string | null,
): { conference?: ProviderTeamConference } {
  if (conference === null || conference === undefined || conference === '') return {};
  const providerCode = String(conference);
  return { conference: division ? { providerCode, divisionProviderCode: division } : { providerCode } };
}
