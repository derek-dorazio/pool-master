export interface TimezoneEntry {
  iana: string;
  label: string;
  region: string;
}

export const TIMEZONE_REGIONS = [
  'Americas',
  'Europe',
  'Asia',
  'Pacific',
  'Africa',
  'Atlantic',
] as const;

export const TIMEZONES: TimezoneEntry[] = [
  // Americas
  { iana: 'America/New_York', label: 'New York (Eastern)', region: 'Americas' },
  { iana: 'America/Chicago', label: 'Chicago (Central)', region: 'Americas' },
  { iana: 'America/Denver', label: 'Denver (Mountain)', region: 'Americas' },
  { iana: 'America/Los_Angeles', label: 'Los Angeles (Pacific)', region: 'Americas' },
  { iana: 'America/Anchorage', label: 'Anchorage (Alaska)', region: 'Americas' },
  { iana: 'Pacific/Honolulu', label: 'Honolulu (Hawaii)', region: 'Americas' },
  { iana: 'America/Phoenix', label: 'Phoenix (No DST)', region: 'Americas' },
  { iana: 'America/Toronto', label: 'Toronto (Eastern)', region: 'Americas' },
  { iana: 'America/Vancouver', label: 'Vancouver (Pacific)', region: 'Americas' },
  { iana: 'America/Winnipeg', label: 'Winnipeg (Central)', region: 'Americas' },
  { iana: 'America/Edmonton', label: 'Edmonton (Mountain)', region: 'Americas' },
  { iana: 'America/Halifax', label: 'Halifax (Atlantic)', region: 'Americas' },
  { iana: 'America/St_Johns', label: 'St. John\'s (Newfoundland)', region: 'Americas' },
  { iana: 'America/Mexico_City', label: 'Mexico City', region: 'Americas' },
  { iana: 'America/Bogota', label: 'Bogota', region: 'Americas' },
  { iana: 'America/Lima', label: 'Lima', region: 'Americas' },
  { iana: 'America/Santiago', label: 'Santiago', region: 'Americas' },
  { iana: 'America/Buenos_Aires', label: 'Buenos Aires', region: 'Americas' },
  { iana: 'America/Sao_Paulo', label: 'Sao Paulo', region: 'Americas' },

  // Europe
  { iana: 'Europe/London', label: 'London (GMT/BST)', region: 'Europe' },
  { iana: 'Europe/Dublin', label: 'Dublin (GMT/IST)', region: 'Europe' },
  { iana: 'Europe/Paris', label: 'Paris (CET)', region: 'Europe' },
  { iana: 'Europe/Berlin', label: 'Berlin (CET)', region: 'Europe' },
  { iana: 'Europe/Amsterdam', label: 'Amsterdam (CET)', region: 'Europe' },
  { iana: 'Europe/Brussels', label: 'Brussels (CET)', region: 'Europe' },
  { iana: 'Europe/Madrid', label: 'Madrid (CET)', region: 'Europe' },
  { iana: 'Europe/Rome', label: 'Rome (CET)', region: 'Europe' },
  { iana: 'Europe/Zurich', label: 'Zurich (CET)', region: 'Europe' },
  { iana: 'Europe/Stockholm', label: 'Stockholm (CET)', region: 'Europe' },
  { iana: 'Europe/Oslo', label: 'Oslo (CET)', region: 'Europe' },
  { iana: 'Europe/Copenhagen', label: 'Copenhagen (CET)', region: 'Europe' },
  { iana: 'Europe/Helsinki', label: 'Helsinki (EET)', region: 'Europe' },
  { iana: 'Europe/Athens', label: 'Athens (EET)', region: 'Europe' },
  { iana: 'Europe/Bucharest', label: 'Bucharest (EET)', region: 'Europe' },
  { iana: 'Europe/Istanbul', label: 'Istanbul', region: 'Europe' },
  { iana: 'Europe/Moscow', label: 'Moscow (MSK)', region: 'Europe' },
  { iana: 'Europe/Warsaw', label: 'Warsaw (CET)', region: 'Europe' },
  { iana: 'Europe/Lisbon', label: 'Lisbon (WET)', region: 'Europe' },

  // Asia
  { iana: 'Asia/Dubai', label: 'Dubai (GST)', region: 'Asia' },
  { iana: 'Asia/Kolkata', label: 'Mumbai / Kolkata (IST)', region: 'Asia' },
  { iana: 'Asia/Karachi', label: 'Karachi (PKT)', region: 'Asia' },
  { iana: 'Asia/Dhaka', label: 'Dhaka (BST)', region: 'Asia' },
  { iana: 'Asia/Bangkok', label: 'Bangkok (ICT)', region: 'Asia' },
  { iana: 'Asia/Singapore', label: 'Singapore (SGT)', region: 'Asia' },
  { iana: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', region: 'Asia' },
  { iana: 'Asia/Shanghai', label: 'Shanghai (CST)', region: 'Asia' },
  { iana: 'Asia/Taipei', label: 'Taipei (CST)', region: 'Asia' },
  { iana: 'Asia/Seoul', label: 'Seoul (KST)', region: 'Asia' },
  { iana: 'Asia/Tokyo', label: 'Tokyo (JST)', region: 'Asia' },
  { iana: 'Asia/Jakarta', label: 'Jakarta (WIB)', region: 'Asia' },
  { iana: 'Asia/Manila', label: 'Manila (PHT)', region: 'Asia' },
  { iana: 'Asia/Riyadh', label: 'Riyadh (AST)', region: 'Asia' },
  { iana: 'Asia/Tehran', label: 'Tehran (IRST)', region: 'Asia' },

  // Pacific
  { iana: 'Australia/Sydney', label: 'Sydney (AEST)', region: 'Pacific' },
  { iana: 'Australia/Melbourne', label: 'Melbourne (AEST)', region: 'Pacific' },
  { iana: 'Australia/Brisbane', label: 'Brisbane (No DST)', region: 'Pacific' },
  { iana: 'Australia/Perth', label: 'Perth (AWST)', region: 'Pacific' },
  { iana: 'Australia/Adelaide', label: 'Adelaide (ACST)', region: 'Pacific' },
  { iana: 'Pacific/Auckland', label: 'Auckland (NZST)', region: 'Pacific' },
  { iana: 'Pacific/Fiji', label: 'Fiji', region: 'Pacific' },

  // Africa
  { iana: 'Africa/Cairo', label: 'Cairo (EET)', region: 'Africa' },
  { iana: 'Africa/Lagos', label: 'Lagos (WAT)', region: 'Africa' },
  { iana: 'Africa/Johannesburg', label: 'Johannesburg (SAST)', region: 'Africa' },
  { iana: 'Africa/Nairobi', label: 'Nairobi (EAT)', region: 'Africa' },
  { iana: 'Africa/Casablanca', label: 'Casablanca (WET)', region: 'Africa' },

  // Atlantic
  { iana: 'Atlantic/Reykjavik', label: 'Reykjavik (GMT)', region: 'Atlantic' },
];

/**
 * Group timezones by region for display in a picker.
 */
export function getTimezonesByRegion(): Record<string, TimezoneEntry[]> {
  const grouped: Record<string, TimezoneEntry[]> = {};
  for (const tz of TIMEZONES) {
    if (!grouped[tz.region]) grouped[tz.region] = [];
    grouped[tz.region].push(tz);
  }
  return grouped;
}

/**
 * Search timezones by label or IANA name.
 */
export function searchTimezones(query: string): TimezoneEntry[] {
  const q = query.toLowerCase();
  return TIMEZONES.filter(
    (tz) => tz.label.toLowerCase().includes(q) || tz.iana.toLowerCase().includes(q),
  );
}
