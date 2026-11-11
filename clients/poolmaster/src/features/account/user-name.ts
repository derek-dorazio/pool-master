export function formatUserName(firstName?: string | null, lastName?: string | null): string {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim();
  return fullName || 'Account';
}

/**
 * Up to two capital letters for the account button: the first and last names' first letters,
 * or null when the account has no name yet.
 */
export function formatUserInitials(firstName?: string | null, lastName?: string | null): string | null {
  const initials = [firstName, lastName]
    .map((part) => part?.trim().charAt(0) ?? '')
    .join('')
    .toUpperCase();
  return initials || null;
}
