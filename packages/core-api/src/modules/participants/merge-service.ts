/**
 * ParticipantMergeService — merges duplicate participant records into one canonical record.
 *
 * When two participants are identified as the same real-world entity (via deduplication),
 * this service merges them: the canonical record keeps the richer data, and the duplicate's
 * provider mappings and references are transferred.
 */

import type {
  ParticipantRepository,
  ParticipantProviderMappingRepository,
  ParticipantSeasonRecordRepository,
} from '@poolmaster/shared/db';
import type { Participant } from '@poolmaster/shared/domain';

export interface MergeResult {
  canonicalId: string;
  mergedId: string;
  mappingsTransferred: number;
  seasonRecordsMerged: number;
}

export class ParticipantMergeService {
  constructor(
    private readonly participantRepo: ParticipantRepository,
    private readonly mappingRepo: ParticipantProviderMappingRepository,
    private readonly seasonRecordRepo: ParticipantSeasonRecordRepository,
  ) {}

  /**
   * Merges the duplicate participant into the canonical participant.
   *
   * Steps:
   * 1. Transfer provider mappings from duplicate to canonical
   * 2. Merge external_ids maps
   * 3. Fill in any missing fields on canonical from duplicate
   * 4. Transfer season records (skip if canonical already has one for that season)
   * 5. Mark duplicate as INACTIVE
   */
  async merge(canonicalId: string, duplicateId: string): Promise<MergeResult> {
    const canonical = await this.participantRepo.findById(canonicalId);
    if (!canonical) throw new MergeError(`Canonical participant not found: ${canonicalId}`);

    const duplicate = await this.participantRepo.findById(duplicateId);
    if (!duplicate) throw new MergeError(`Duplicate participant not found: ${duplicateId}`);

    if (canonical.sportId !== duplicate.sportId) {
      throw new MergeError('Cannot merge participants from different sports');
    }

    // 1. Transfer provider mappings
    const dupMappings = await this.mappingRepo.findByParticipant(duplicateId);
    let mappingsTransferred = 0;
    for (const mapping of dupMappings) {
      // Check if canonical already has a mapping for this provider
      const existing = await this.mappingRepo.findByProvider(mapping.providerId, mapping.externalId);
      if (!existing || existing.participantId === duplicateId) {
        await this.mappingRepo.create({
          participantId: canonicalId,
          providerId: mapping.providerId,
          externalId: mapping.externalId,
          confidence: 'MANUAL',
          mappedAt: new Date(),
        });
        mappingsTransferred++;
      }
    }

    // 2. Merge external_ids
    const mergedExternalIds: Record<string, string> = {
      ...duplicate.externalIds,
      ...canonical.externalIds, // canonical takes precedence
    };

    // 3. Fill in missing fields from duplicate
    const updates: Partial<Participant> = { externalIds: mergedExternalIds };
    if (!canonical.firstName && duplicate.firstName) updates.firstName = duplicate.firstName;
    if (!canonical.lastName && duplicate.lastName) updates.lastName = duplicate.lastName;
    if (!canonical.shortName && duplicate.shortName) updates.shortName = duplicate.shortName;
    if (!canonical.nationality && duplicate.nationality) updates.nationality = duplicate.nationality;
    if (!canonical.position && duplicate.position) updates.position = duplicate.position;
    if (!canonical.teamAffiliation && duplicate.teamAffiliation) {
      updates.teamAffiliation = duplicate.teamAffiliation;
    }
    if (!canonical.photoUrl && duplicate.photoUrl) updates.photoUrl = duplicate.photoUrl;

    await this.participantRepo.update(canonicalId, updates);

    // 4. Transfer season records
    const dupSeasonRecords = await this.seasonRecordRepo.findByParticipant(duplicateId);
    const canonSeasonRecords = await this.seasonRecordRepo.findByParticipant(canonicalId);
    const canonSeasons = new Set(canonSeasonRecords.map((r) => r.season));

    let seasonRecordsMerged = 0;
    for (const record of dupSeasonRecords) {
      if (!canonSeasons.has(record.season)) {
        await this.seasonRecordRepo.upsert({
          ...record,
          participantId: canonicalId,
        });
        seasonRecordsMerged++;
      }
    }

    // 5. Mark duplicate as inactive
    await this.participantRepo.update(duplicateId, { status: 'INACTIVE' as Participant['status'] });

    return {
      canonicalId,
      mergedId: duplicateId,
      mappingsTransferred,
      seasonRecordsMerged,
    };
  }
}

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeError';
  }
}
