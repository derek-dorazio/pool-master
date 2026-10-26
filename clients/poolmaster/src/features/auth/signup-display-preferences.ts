import { browserLocale } from '@/features/shared/ui';
import { hasErrorCode } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

export type SignupDisplayPreferences = { timezone?: string; locale?: string };

/**
 * Sends a signup with the chosen time zone and the browser's locale (#1041). Both come from the
 * browser, whose zone and locale data can be newer than the server's, so when the server
 * refuses either one the signup is sent again without them: the account is created with US
 * Eastern and en-US, which the member can change on their account page. An unusual browser never
 * blocks signing up.
 */
export async function signUpWithDisplayPreferences<Response extends { error?: unknown }>(
  timezone: string,
  send: (preferences: SignupDisplayPreferences) => Promise<Response>,
): Promise<Response> {
  const preferences = { timezone, locale: browserLocale() };
  const response = await send(preferences);
  if (!hasErrorCode(response.error, 'TIME_ZONE_UNKNOWN') && !hasErrorCode(response.error, 'LOCALE_UNKNOWN')) {
    return response;
  }
  getLogger().child({ feature: 'signup' }).warn(
    { action: 'auth.register.displayPreferencesRefused', data: preferences },
    'Server refused the browser time zone or locale; signing up without them',
  );
  return send({});
}
