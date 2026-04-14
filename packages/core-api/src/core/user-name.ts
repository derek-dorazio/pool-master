export function formatUserFullName(firstName?: string | null, lastName?: string | null): string {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim();
  return fullName || 'Unknown User';
}

export function buildDefaultSquadName(firstName?: string | null, lastName?: string | null): string {
  return `${formatUserFullName(firstName, lastName)}'s Team`;
}
