export function buildDefaultTeamName(firstName?: string | null, lastName?: string | null) {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim();
}
