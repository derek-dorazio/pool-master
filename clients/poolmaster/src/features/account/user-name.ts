export function formatUserName(firstName?: string | null, lastName?: string | null): string {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim();
  return fullName || 'Account';
}
