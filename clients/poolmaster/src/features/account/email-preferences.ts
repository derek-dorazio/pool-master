import { useQuery } from '@tanstack/react-query';
import type { EmailPreferencesResponse } from '@poolmaster/shared/dto';
import { OptionalEmailCategory } from '@poolmaster/shared/domain';
import { getUserEmailPreferences } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { SELF_USER_ID } from './user-routing';

/**
 * Which categories of email a member gets (#844 slice 5): one switch per category, the same for
 * every league. Account and membership emails have no switch.
 */
export const EMAIL_CATEGORY_LABELS: Record<OptionalEmailCategory, { label: string; description: string }> = {
  [OptionalEmailCategory.COMMISSIONER_UPDATES]: {
    label: 'Commissioner updates',
    description: 'For commissioners: new members, pending invitations, upcoming events to set up contests for, and settling up.',
  },
  [OptionalEmailCategory.CONTEST_UPDATES]: {
    label: 'Contest updates',
    description: 'New contests, entry reminders before picks close, and changes to your picks.',
  },
  [OptionalEmailCategory.LIVE_STANDINGS]: {
    label: 'Live standings',
    description: 'When a contest goes live, and the standings while it runs.',
  },
  [OptionalEmailCategory.RESULTS]: {
    label: 'Results',
    description: 'Final standings and winners when a contest ends.',
  },
  [OptionalEmailCategory.RECEIPTS]: {
    label: 'Entry receipts',
    description: 'A copy of your picks each time you submit them.',
  },
};

export const SELF_EMAIL_PREFERENCES_KEY = QueryKeys.emailPreferences.detail(SELF_USER_ID);

async function fetchOwnEmailPreferences(): Promise<EmailPreferencesResponse> {
  const response = await getUserEmailPreferences({ path: { userId: SELF_USER_ID } });
  if (!response.data) {
    throwApiError(response.error, 'Email preferences response is missing data.');
  }
  return response.data;
}

export function useOwnEmailPreferences(enabled = true) {
  return useQuery({
    queryKey: SELF_EMAIL_PREFERENCES_KEY,
    queryFn: fetchOwnEmailPreferences,
    enabled,
  });
}
