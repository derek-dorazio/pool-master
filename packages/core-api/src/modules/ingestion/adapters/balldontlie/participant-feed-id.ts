/**
 * A participant's feed id (#2040): the provider's own raw id, never prefixed with its league. A
 * ParticipantProviderMapping is unique on provider, id, sport league and kind of participant, so
 * a team and a golfer the provider numbers alike, or two leagues' team 12, never collide.
 */
export function participantFeedId(providerId: number): string {
  return String(providerId);
}
