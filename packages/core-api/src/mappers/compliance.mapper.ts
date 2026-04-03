function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function mapConsentRecordToDto(record: Record<string, unknown>) {
  return {
    id: String(record.id),
    userId: String(record.userId),
    consentType: String(record.consentType),
    granted: Boolean(record.granted),
    version: String(record.version),
    ipAddress: record.ipAddress == null ? undefined : String(record.ipAddress),
    userAgent: record.userAgent == null ? undefined : String(record.userAgent),
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
  };
}

export function mapSelfExclusionToDto(exclusion: Record<string, unknown> | null) {
  if (!exclusion) {
    return null;
  }
  return {
    id: String(exclusion.id),
    userId: String(exclusion.userId),
    exclusionType: String(exclusion.exclusionType),
    duration: String(exclusion.duration),
    endsAt: exclusion.endsAt instanceof Date ? toIso(exclusion.endsAt) : undefined,
    isActive: Boolean(exclusion.isActive),
    startedAt: exclusion.startedAt instanceof Date
      ? exclusion.startedAt.toISOString()
      : String(exclusion.startedAt),
    reactivatedAt: exclusion.reactivatedAt instanceof Date ? toIso(exclusion.reactivatedAt) : undefined,
  };
}

export function mapEnforcementActionToDto(action: Record<string, unknown>) {
  return {
    id: String(action.id),
    userId: String(action.userId),
    level: String(action.level),
    reason: String(action.reason),
    trigger: String(action.trigger),
    enforcedBy: action.enforcedBy == null ? undefined : String(action.enforcedBy),
    endsAt: action.endsAt instanceof Date ? toIso(action.endsAt) : undefined,
    appealStatus: action.appealStatus == null ? undefined : String(action.appealStatus),
    createdAt: action.createdAt instanceof Date ? action.createdAt.toISOString() : String(action.createdAt),
  };
}
