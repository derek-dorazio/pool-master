import type { ContestTimingPolicy, SportEventReadinessReason, SportEventReadinessStatus } from '@poolmaster/shared/domain';

interface EventTimingInput {
  sport: string;
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

const RELATIVE_RULE_PATTERN =
  /^(?<days>\d+)\s+day(?:s)?\s+prior\s+at\s+(?<hour>\d{1,2}):(?<minute>\d{2})$/i;

export function resolveEventTiming(
  input: EventTimingInput,
  policy?: Pick<ContestTimingPolicy, 'releaseRule' | 'fieldLockRule'> | null,
): ResolvedEventTiming {
  const releaseAt = readMetadataDate(input.metadata, 'releaseAt')
    ?? applyRelativeRule(input.startDate, policy?.releaseRule);
  const fieldLocksAt = readMetadataDate(input.metadata, 'fieldLocksAt')
    ?? applyRelativeRule(input.startDate, policy?.fieldLockRule);

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

export function selectTimingPolicy(
  policies: readonly Pick<
    ContestTimingPolicy,
    'eventType' | 'isDefault' | 'releaseRule' | 'fieldLockRule'
  >[],
  metadata: Record<string, unknown>,
): Pick<
  ContestTimingPolicy,
  'eventType' | 'isDefault' | 'releaseRule' | 'fieldLockRule'
> | null {
  const eventType =
    typeof metadata.eventType === 'string' && metadata.eventType.trim() !== ''
      ? metadata.eventType.trim()
      : null;

  const exactMatch =
    eventType === null
      ? null
      : policies.find((policy) => policy.eventType === eventType);

  return exactMatch ?? policies.find((policy) => policy.isDefault) ?? policies[0] ?? null;
}

function applyRelativeRule(startDate: Date, rule?: string | null): Date {
  if (!rule) {
    return new Date(startDate);
  }

  const match = RELATIVE_RULE_PATTERN.exec(rule.trim());
  if (!match?.groups) {
    return new Date(startDate);
  }

  const days = Number.parseInt(match.groups.days, 10);
  const hour = Number.parseInt(match.groups.hour, 10);
  const minute = Number.parseInt(match.groups.minute, 10);

  if (
    Number.isNaN(days) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return new Date(startDate);
  }

  const resolved = new Date(startDate);
  resolved.setUTCDate(resolved.getUTCDate() - days);
  resolved.setUTCHours(hour, minute, 0, 0);
  return resolved;
}
