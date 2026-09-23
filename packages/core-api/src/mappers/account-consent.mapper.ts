interface ConsentRecordRow {
  id: string;
  userId: string;
  consentType: string;
  granted: boolean;
  version: string;
  minimumAgeThreshold: number | null;
  ageAffirmed: boolean | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export function mapConsentRecordToDto(record: ConsentRecordRow) {
  return {
    id: record.id,
    userId: record.userId,
    consentType: record.consentType,
    granted: record.granted,
    version: record.version,
    minimumAgeThreshold: record.minimumAgeThreshold ?? undefined,
    ageAffirmed: record.ageAffirmed ?? undefined,
    ipAddress: record.ipAddress ?? undefined,
    userAgent: record.userAgent ?? undefined,
    createdAt: record.createdAt.toISOString(),
  };
}
