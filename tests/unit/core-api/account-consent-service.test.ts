import { AccountConsentService } from '../../../packages/core-api/src/modules/account-consent/account-consent-service';

describe('AccountConsentService', () => {
  it('records consent with age affirmation fields', async () => {
    const prisma = {
      consentRecord: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as any;

    const service = new AccountConsentService(prisma);

    await service.recordConsent({
      userId: 'user-1',
      consentType: 'terms_of_service',
      granted: true,
      version: '2026-04',
      minimumAgeThreshold: 18,
      ageAffirmed: true,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(prisma.consentRecord.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        consentType: 'terms_of_service',
        granted: true,
        version: '2026-04',
        minimumAgeThreshold: 18,
        ageAffirmed: true,
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    });
  });

  it('returns consent history in newest-first order', async () => {
    const prisma = {
      consentRecord: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c-2', userId: 'user-1', createdAt: new Date('2026-04-02T00:00:00.000Z') },
          { id: 'c-1', userId: 'user-1', createdAt: new Date('2026-04-01T00:00:00.000Z') },
        ]),
      },
    } as any;

    const service = new AccountConsentService(prisma);

    await expect(service.getConsentHistory('user-1')).resolves.toHaveLength(2);
    expect(prisma.consentRecord.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns the latest grant state for a consent type', async () => {
    const prisma = {
      consentRecord: {
        findFirst: jest.fn().mockResolvedValue({ granted: false }),
      },
    } as any;

    const service = new AccountConsentService(prisma);

    await expect(service.hasActiveConsent('user-1', 'terms_of_service')).resolves.toBe(false);
  });
});
