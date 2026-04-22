import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

export class AccountConsentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: FastifyBaseLogger,
  ) {}

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
    this.logger?.debug({
      action: 'accountConsentService.record.start',
      data: {
        userId: params.userId,
        consentType: params.consentType,
        granted: params.granted,
        version: params.version,
      },
    }, 'Recording consent');
    const record = await this.prisma.consentRecord.create({
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
    this.logger?.info({
      action: 'accountConsentService.record.success',
      data: {
        userId: params.userId,
        consentType: params.consentType,
        granted: params.granted,
      },
    }, 'Recorded consent');
    return record;
  }

  async getConsentHistory(userId: string): Promise<unknown[]> {
    this.logger?.debug({
      action: 'accountConsentService.history.start',
      data: { userId },
    }, 'Loading consent history');
    const history = await this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    this.logger?.info({
      action: 'accountConsentService.history.success',
      data: {
        userId,
        recordCount: history.length,
      },
    }, 'Loaded consent history');
    return history;
  }

  async hasActiveConsent(userId: string, consentType: string): Promise<boolean> {
    this.logger?.debug({
      action: 'accountConsentService.hasActive.start',
      data: { userId, consentType },
    }, 'Checking active consent state');
    const latest = await this.prisma.consentRecord.findFirst({
      where: { userId, consentType },
      orderBy: { createdAt: 'desc' },
    });
    const granted = latest?.granted ?? false;
    this.logger?.info({
      action: 'accountConsentService.hasActive.success',
      data: { userId, consentType, granted },
    }, 'Resolved active consent state');
    return granted;
  }
}
