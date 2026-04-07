export function mapConsentRecordToDto(record: Record<string, unknown>) {
  return {
    id: String(record.id),
    userId: String(record.userId),
    consentType: String(record.consentType),
    granted: Boolean(record.granted),
    version: String(record.version),
    minimumAgeThreshold: record.minimumAgeThreshold == null ? undefined : Number(record.minimumAgeThreshold),
    ageAffirmed: record.ageAffirmed == null ? undefined : Boolean(record.ageAffirmed),
    ipAddress: record.ipAddress == null ? undefined : String(record.ipAddress),
    userAgent: record.userAgent == null ? undefined : String(record.userAgent),
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
  };
}
