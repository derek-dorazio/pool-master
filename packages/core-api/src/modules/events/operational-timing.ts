import type { SportEventReadinessReason, SportEventReadinessStatus } from '@poolmaster/shared/domain';

interface EventTimingInput {
  startDate: Date;
  metadata: Record<string, unknown>;
}

interface ResolvedEventTiming {
  releaseAt: Date;
  fieldLocksAt: Date;
}

export interface EventOperationalState extends ResolvedEventTiming {
  fieldLocked: boolean;
  readinessStatus: SportEventReadinessStatus;
  readinessReasons: SportEventReadinessReason[];
  contestEligible: boolean;
}

/**
 * An event's release and field-lock times: the provider's own timestamps when its metadata
 * carries them, otherwise the event's start. #263 removed the seeded timing policies that
 * could have supplied rule-based defaults ("N days prior at HH:MM") — nothing ever seeded
 * one; plans/145 records the rule language.
 */
export function resolveEventTiming(input: EventTimingInput): ResolvedEventTiming {
  const releaseAt = readMetadataDate(input.metadata, 'releaseAt') ?? new Date(input.startDate);
  const fieldLocksAt = readMetadataDate(input.metadata, 'fieldLocksAt') ?? new Date(input.startDate);

  return {
    releaseAt,
    fieldLocksAt,
  };
}

function readMetadataDate(
  metadata: Record<string, unknown>,
  key: 'releaseAt' | 'fieldLocksAt',
): Date | null {
  const value = metadata[key];
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function evaluateEventOperationalState(input: {
  participantCount?: number | null;
  releaseAt: Date;
  fieldLocksAt: Date;
  providerFieldLocked: boolean;
  now?: Date;
}): EventOperationalState {
  const now = input.now ?? new Date();
  const readinessReasons: SportEventReadinessReason[] = [];

  if (now < input.releaseAt) {
    readinessReasons.push('EVENT_NOT_RELEASED');
  }

  if ((input.participantCount ?? 0) <= 0) {
    readinessReasons.push('FIELD_NOT_LOADED');
  }

  if (input.providerFieldLocked || now >= input.fieldLocksAt) {
    readinessReasons.push('FIELD_LOCKED');
  }

  let readinessStatus: SportEventReadinessStatus = 'CONTEST_ELIGIBLE';
  if (readinessReasons.includes('FIELD_LOCKED')) {
    readinessStatus = 'FIELD_LOCKED';
  } else if (readinessReasons.includes('EVENT_NOT_RELEASED')) {
    readinessStatus = 'NOT_RELEASED';
  } else if (readinessReasons.includes('FIELD_NOT_LOADED')) {
    readinessStatus = 'PENDING_FIELD';
  }

  return {
    releaseAt: input.releaseAt,
    fieldLocksAt: input.fieldLocksAt,
    fieldLocked: readinessReasons.includes('FIELD_LOCKED'),
    readinessStatus,
    readinessReasons,
    contestEligible: readinessReasons.length === 0,
  };
}
