import type { PrismaClient } from '@prisma/client';

export class AccountConsentService {
  constructor(private readonly prisma: PrismaClient) {}

  async recordConsent(params: {
    userId: string;
    consentType: string;
    granted: boolean;
    version: string;
    minimumAgeThreshold?: number | null;
    ageAffirmed?: boolean | null;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.consentRecord.create({
      data: {
        userId: params.userId,
        consentType: params.consentType,
        granted: params.granted,
        version: params.version,
        minimumAgeThreshold: params.minimumAgeThreshold ?? null,
        ageAffirmed: params.ageAffirmed ?? null,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  }

  async getConsentHistory(userId: string): Promise<unknown[]> {
    return this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async hasActiveConsent(userId: string, consentType: string): Promise<boolean> {
    const latest = await this.prisma.consentRecord.findFirst({
      where: { userId, consentType },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.granted ?? false;
  }
}
