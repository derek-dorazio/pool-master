import { AuthProvider, type EmailSuppressionReason } from '@poolmaster/shared/domain';

/** How the account header names the sign-in method, as a whole sentence. Page sentences, which move to the display strings later (#1962). */
export const SIGN_IN_METHOD_SENTENCES: Record<AuthProvider, string> = {
  [AuthProvider.EMAIL]: 'Signs in with email',
  [AuthProvider.GOOGLE]: 'Signs in with Google',
  [AuthProvider.APPLE]: 'Signs in with Apple',
};

/** What a choice left to the device reads as, for the clock, the locale and the theme. */
export const MATCH_MY_DEVICE = 'Match my device';

export const EMAIL_SUPPRESSION_MESSAGES: Record<EmailSuppressionReason, string> = {
  BOUNCE: 'Email to your address bounced, so we have stopped emailing you. Change your email under Profile to start again.',
  COMPLAINT: 'An email from us was marked as spam, so we have stopped emailing you. Change your email under Profile to start again.',
};

/** The fallback for an account action the server refused without saying why. */
export const ACCOUNT_ACTION_ERROR = 'We could not complete that account action. Please try again.';
