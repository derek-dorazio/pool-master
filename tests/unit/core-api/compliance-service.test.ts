import { ComplianceService } from '../../../packages/core-api/src/modules/compliance/compliance-service';

describe('ComplianceService data export status', () => {
  it('returns none when no export request exists', async () => {
    const prisma = {
      dataExportRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getDataExportStatus('user-1')).resolves.toEqual({
      status: 'none',
      requestedAt: null,
      downloadUrl: null,
      expiresAt: null,
      nextAllowedAt: null,
    });

    expect(prisma.dataExportRequest.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { requestedAt: 'desc' },
    });
  });

  it('maps the latest completed export request to ready status', async () => {
    const prisma = {
      dataExportRequest: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          requestedAt: new Date('2026-04-01T12:00:00.000Z'),
          downloadUrl: 'https://example.com/export.csv',
          downloadExpiresAt: new Date('2026-04-02T12:00:00.000Z'),
        }),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getDataExportStatus('user-1')).resolves.toEqual({
      status: 'ready',
      requestedAt: '2026-04-01T12:00:00.000Z',
      downloadUrl: 'https://example.com/export.csv',
      expiresAt: '2026-04-02T12:00:00.000Z',
      nextAllowedAt: null,
    });
  });
});
