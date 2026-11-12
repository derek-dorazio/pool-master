import { AuthProvider, ColorScheme, TimeFormat } from '@poolmaster/shared/domain';
import type { EmailSuppressionReason } from '@poolmaster/shared/domain';

/** How each sign-in method reads in "Signs in with …". */
export const SIGN_IN_METHOD_LABELS: Record<AuthProvider, string> = {
  [AuthProvider.EMAIL]: 'email',
  [AuthProvider.GOOGLE]: 'Google',
  [AuthProvider.APPLE]: 'Apple',
};

/** What a choice left to the device reads as, for the clock, the locale and the theme. */
export const MATCH_MY_DEVICE = 'Match my device';

export const TIME_FORMAT_LABELS: Record<TimeFormat, string> = {
  [TimeFormat.TWELVE_HOUR]: '12-hour',
  [TimeFormat.TWENTY_FOUR_HOUR]: '24-hour',
};

export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  [ColorScheme.DEVICE]: MATCH_MY_DEVICE,
  [ColorScheme.LIGHT]: 'Light',
  [ColorScheme.DARK]: 'Dark',
};

export const EMAIL_SUPPRESSION_MESSAGES: Record<EmailSuppressionReason, string> = {
  BOUNCE: 'Email to your address bounced, so we have stopped emailing you. Change your email under Profile to start again.',
  COMPLAINT: 'An email from us was marked as spam, so we have stopped emailing you. Change your email under Profile to start again.',
};

/** The fallback for an account action the server refused without saying why. */
export const ACCOUNT_ACTION_ERROR = 'We could not complete that account action. Please try again.';
