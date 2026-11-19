import { assertNever } from '@poolmaster/shared/domain';
import { formatDateTimeDisplay, type DisplayPreferences } from '@/features/shared/ui';
import type { ReleaseCheckDto, SportEventOverviewDto } from '@/lib/api';
import { plural } from '@/lib/plural';

/** The value a ready check was judged on, as data in a few words. */
export function releaseCheckValueText(check: ReleaseCheckDto, preferences: DisplayPreferences): string {
  switch (check.key) {
    case 'NOT_STARTED':
      return `Starts ${formatDateTimeDisplay(check.value, preferences)}`;
    case 'ROUNDS_SCHEDULED':
      return plural(check.value, 'round');
    case 'FIELD_LOADED':
      return `${plural(check.value, 'participant')} active`;
    case 'TIERS_ASSIGNED':
      return `${plural(check.value, 'participant')} without a tier`;
    case 'TIERS_FILLED':
      return check.value.length === 0 ? 'None empty' : `Empty: ${check.value.join(', ')}`;
    case 'PRICES_ASSIGNED':
      return check.value === null ? 'Not priced' : `${plural(check.value, 'participant')} without a price`;
    case 'BRACKET_COMPLETE':
      return check.value.length === 0 ? 'Complete' : check.value.join(', ');
    case 'CONTEST_SETUPS_ON':
      return `${plural(check.value, 'contest template')} on`;
    default:
      return assertNever(check);
  }
}

/** When automatic release tries, or when the event was released; a dash when neither applies. */
export function releaseTriesText(overview: Pick<SportEventOverviewDto, 'releaseAt' | 'releaseAtKind'> | undefined, preferences: DisplayPreferences): string {
  if (overview?.releaseAt == null) return '—';
  const at = formatDateTimeDisplay(overview.releaseAt, preferences);
  return overview.releaseAtKind === 'ACTUAL' ? `Released ${at}` : `Hourly from ${at}`;
}
