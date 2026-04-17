export function buildDefaultTeamName(firstName?: string | null, lastName?: string | null) {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim();
  return fullName ? `${fullName}'s Team` : 'My Team';
}
