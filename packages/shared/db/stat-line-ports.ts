/**
 * Repository port for the composite family's extension rows (#934): a stat pool player's stat
 * lines, one per participant round and stat. The loader and the admin stat grid write them (#935).
 */

import type { SportEventParticipantStatLine } from '../domain';

export interface SportEventParticipantStatLineRepository {
  /** Every stat line at the event, by participant round then stat. */
  findBySportEvent(sportEventId: string): Promise<SportEventParticipantStatLine[]>;
}
