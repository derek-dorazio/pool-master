/**
 * What follows a feed id being mapped to a participant (#2069): its OPEN unmapped participant
 * finding resolves, whichever path made the mapping. Once an id is mapped the score writer stops
 * reporting it, so without this a finding fixed by the participant's own mapping route or by a
 * later roster sync would stay OPEN for good. Its handler is
 * `ProviderSyncFindingService.resolveMappedParticipants`.
 */

import { z } from 'zod';
import { BackgroundJobType } from '@poolmaster/shared/domain';
import { DISCARD_BACKGROUND_JOB, type BackgroundJobAnswer } from '../../background-jobs/background-job-outcome';
import type { DomainEventType } from '../../domain-events/domain-event';
import type { DomainEventHandler } from '../../domain-events/domain-event-handler';

export const ResolveMappedParticipantFindingsJobPayloadSchema = z.object({
  sportLeagueId: z.string().min(1),
  /** The Provider row whose feed ids were mapped. */
  providerId: z.string().min(1),
  externalIds: z.array(z.string().min(1)).min(1),
});
export type ResolveMappedParticipantFindingsJobPayload = z.infer<typeof ResolveMappedParticipantFindingsJobPayloadSchema>;

/** Every mapping write, however it was made, resolves the findings of the ids it mapped. */
export const resolveMappedParticipantFindingsHandler: DomainEventHandler<typeof DomainEventType.PARTICIPANT_PROVIDER_MAPPED> = {
  key: 'resolve-mapped-participant-findings',
  queues: [BackgroundJobType.RESOLVE_MAPPED_PARTICIPANT_FINDINGS],
  when: (event) => event.externalIds.length > 0,
  jobs: (event, { queue }) => [queue.request(BackgroundJobType.RESOLVE_MAPPED_PARTICIPANT_FINDINGS, {
    sportLeagueId: event.sportLeagueId,
    providerId: event.providerId,
    externalIds: [...event.externalIds],
  })],
};

/**
 * The job's handler: the findings resolve. A mapping whose ids had no OPEN finding, the usual
 * case for a roster sync's new participants, leaves no row in Activity.
 */
export function resolveMappedParticipantFindingsJobHandler(findings: { resolveMappedParticipants(payload: ResolveMappedParticipantFindingsJobPayload): Promise<number> }) {
  return async (payload: ResolveMappedParticipantFindingsJobPayload): Promise<BackgroundJobAnswer> => {
    const resolved = await findings.resolveMappedParticipants(payload);
    return resolved === 0 ? DISCARD_BACKGROUND_JOB : { changedCount: resolved };
  };
}
