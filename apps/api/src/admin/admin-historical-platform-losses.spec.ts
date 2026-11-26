import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ADMIN_PERMISSION_KEY } from '../common/decorators/admin-permission.decorator';
import { HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS } from './historical-platform-loss.dto';

function commonBody() {
  return {
    provider: ' zhipu ',
    providerAccountRef: ' account-1 ',
    region: ' domestic ',
    periodStart: '2026-07-01',
    periodEnd: '2026-08-01',
    currency: 'cny',
    sourceFileRef: ' oss://finance/source.xlsx?versionId=1 ',
    sourceFileSha256: 'A'.repeat(64),
    calculationMethod: 'TOKEN_RATE_PER_MILLION_V1',
    roundingPolicy: 'HALF_UP_12',
    exchangeRate: '7.2',
    exchangeRateSource: 'PBOC',
    exchangeRateSourceCurrency: 'USD',
    exchangeRateAsOf: '2026-07-31T00:00:00.000Z',
    reason: ' FIN-42 platform absorption ',
    lines: [{
      lineType: 'PROVIDER_AGGREGATE',
      sourceRowRef: ' 2 ',
      sourceEvidence: { source: 'provider-statement', row: 2 },
      serviceDate: '2026-07-01',
      model: ' glm-5.2 ',
      meter: ' input ',
      platformUsage: '100',
      providerUsage: '110',
      providerAggregateRef: ' 2026-07-01|glm-5.2|INPUT ',
      valuationBasis: {
        version: ' glm-2026-07-v1 ',
        rateUnit: 'TOKENS_PER_MILLION',
        pricingCurrency: 'cny',
        customerRatePerMillion: '4',
        providerCostRatePerMillion: '2',
        pricingSourceRef: 'oss://finance-pricing/glm-v1.json?versionId=1',
        pricingDocumentSha256: 'C'.repeat(64),
        pricingEvidenceHash: 'D'.repeat(64),
        pricingEffectiveFrom: '2026-07-01',
        pricingEffectiveTo: '2026-08-01',
        pricingApprovedBy: 'finance-pricing-committee',
        pricingApprovedAt: '2026-06-30T08:00:00.000Z',
        pricingEvidence: {
          sourceRef: 'oss://finance-pricing/glm-v1.json?versionId=1',
          documentSha256: 'c'.repeat(64),
        },
      },
    }],
  };
}

describe('AdminController - historical platform losses', () => {
  let service: {
    previewHistoricalPlatformLossBatch: jest.Mock;
    createHistoricalPlatformLossBatch: jest.Mock;
    listHistoricalPlatformLossBatches: jest.Mock;
    getHistoricalPlatformLossBatch: jest.Mock;
    approveAndPostHistoricalPlatformLossBatch: jest.Mock;
    exportHistoricalPlatformLossBatch: jest.Mock;
  };
  let controller: AdminController;

  beforeEach(() => {
    service = {
      previewHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ status: 'READY' }),
      createHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      listHistoricalPlatformLossBatches: jest.fn().mockResolvedValue({ items: [] }),
      getHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      approveAndPostHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ status: 'POSTED' }),
      exportHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ schemaVersion: 'historical-platform-loss-export.v1' }),
    };
    controller = new AdminController(service as never);
  });

  it('normalizes the token and frozen valuation contract before proxying preview/create', async () => {
    const body = commonBody();
    await controller.previewHistoricalPlatformLossBatch(body);
    await controller.createHistoricalPlatformLossBatch({
      ...body,
      expectedFingerprint: 'B'.repeat(64),
      idempotencyKey: ' prepare-1 ',
    }, 'maker-1');

    expect(service.previewHistoricalPlatformLossBatch).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'zhipu',
      currency: 'CNY',
      sourceFileSha256: 'a'.repeat(64),
      lines: [expect.objectContaining({
        meter: 'INPUT',
        platformUsage: '100',
        providerUsage: '110',
        valuationBasis: expect.objectContaining({ pricingCurrency: 'CNY' }),
      })],
    }));
    expect(service.createHistoricalPlatformLossBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedFingerprint: 'b'.repeat(64),
        idempotencyKey: 'prepare-1',
        reason: 'FIN-42 platform absorption',
      }),
      'maker-1',
    );
  });

  it('rejects client supplied money and requires the reason in both preview and create fingerprints', async () => {
    const body = commonBody();
    const unsafeLine = { ...body.lines[0], customerAbsorbedDelta: '999' };
    await expect(controller.previewHistoricalPlatformLossBatch({ ...body, lines: [unsafeLine] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.previewHistoricalPlatformLossBatch({ ...body, reason: undefined }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.createHistoricalPlatformLossBatch({
      ...body,
      reason: undefined,
      expectedFingerprint: 'b'.repeat(64),
      idempotencyKey: 'prepare-1',
    }, 'maker-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.createHistoricalPlatformLossBatch).not.toHaveBeenCalled();
  });

  it('accepts every Billing-aligned historical text field at its exact boundary', async () => {
    const body = commonBody();
    const boundaryBody = {
      ...body,
      providerAccountRef: 'a'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.providerAccountRef),
      sourceFileRef: 's'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.sourceFileRef),
      reason: 'r'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.reason),
      lines: [{
        ...body.lines[0],
        sourceRowRef: 'l'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.sourceRowRef),
        valuationBasis: {
          ...body.lines[0].valuationBasis,
          version: 'v'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.valuationVersion),
        },
      }],
    };

    await controller.previewHistoricalPlatformLossBatch(boundaryBody);
    await controller.approveAndPostHistoricalPlatformLossBatch(
      'batch-1',
      {
        expectedRevision: 0,
        expectedFingerprint: 'b'.repeat(64),
        reason: 'r'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.reason),
        idempotencyKey: 'approve-boundary',
      },
      'checker-1',
      'finance',
    );

    expect(service.previewHistoricalPlatformLossBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        providerAccountRef: boundaryBody.providerAccountRef,
        sourceFileRef: boundaryBody.sourceFileRef,
        reason: boundaryBody.reason,
        lines: [expect.objectContaining({
          sourceRowRef: boundaryBody.lines[0].sourceRowRef,
          valuationBasis: expect.objectContaining({
            version: boundaryBody.lines[0].valuationBasis.version,
          }),
        })],
      }),
    );
    expect(service.approveAndPostHistoricalPlatformLossBatch).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({
        reason: 'r'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.reason),
      }),
      'checker-1',
    );
  });

  it('rejects every Billing-aligned historical text field above its boundary', async () => {
    const body = commonBody();
    const invalidBodies = [
      {
        ...body,
        providerAccountRef: 'a'.repeat(
          HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.providerAccountRef + 1,
        ),
      },
      {
        ...body,
        sourceFileRef: 's'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.sourceFileRef + 1),
      },
      {
        ...body,
        reason: 'r'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.reason + 1),
      },
      {
        ...body,
        lines: [{
          ...body.lines[0],
          sourceRowRef: 'l'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.sourceRowRef + 1),
        }],
      },
      {
        ...body,
        lines: [{
          ...body.lines[0],
          valuationBasis: {
            ...body.lines[0].valuationBasis,
            version: 'v'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.valuationVersion + 1),
          },
        }],
      },
    ];

    for (const invalidBody of invalidBodies) {
      await expect(controller.previewHistoricalPlatformLossBatch(invalidBody))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(controller.approveAndPostHistoricalPlatformLossBatch(
      'batch-1',
      {
        expectedRevision: 0,
        expectedFingerprint: 'b'.repeat(64),
        reason: 'r'.repeat(HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.reason + 1),
        idempotencyKey: 'approve-over-limit',
      },
      'checker-1',
      'finance',
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(service.previewHistoricalPlatformLossBatch).not.toHaveBeenCalled();
    expect(service.approveAndPostHistoricalPlatformLossBatch).not.toHaveBeenCalled();
  });

  it.each(['admin', 'operator', 'viewer', 'custom'])('rejects %s approval even if the endpoint permission was accidentally granted', async (role) => {
    await expect(controller.approveAndPostHistoricalPlatformLossBatch(
      'batch-1',
      {
        expectedRevision: 0,
        expectedFingerprint: 'b'.repeat(64),
        reason: 'approved',
        idempotencyKey: 'approve-1',
      },
      'admin-1',
      role,
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.approveAndPostHistoricalPlatformLossBatch).not.toHaveBeenCalled();
  });

  it.each(['finance', 'super_admin'])('allows %s to proxy the CAS approval contract', async (role) => {
    await controller.approveAndPostHistoricalPlatformLossBatch(
      'batch-1',
      {
        expectedRevision: 0,
        expectedFingerprint: 'B'.repeat(64),
        reason: ' approved FIN-42 ',
        idempotencyKey: ' approve-1 ',
      },
      'checker-1',
      role,
    );
    expect(service.approveAndPostHistoricalPlatformLossBatch).toHaveBeenCalledWith(
      'batch-1',
      {
        expectedRevision: 0,
        expectedFingerprint: 'b'.repeat(64),
        reason: 'approved FIN-42',
        idempotencyKey: 'approve-1',
      },
      'checker-1',
    );
  });

  it('keeps every action on its own permission and does not reuse gateway manage', () => {
    const expected = [
      ['previewHistoricalPlatformLossBatch', 'admin.page.historical_platform_losses.prepare'],
      ['createHistoricalPlatformLossBatch', 'admin.page.historical_platform_losses.prepare'],
      ['listHistoricalPlatformLossBatches', 'admin.page.historical_platform_losses.view'],
      ['getHistoricalPlatformLossBatch', 'admin.page.historical_platform_losses.view'],
      ['approveAndPostHistoricalPlatformLossBatch', 'admin.page.historical_platform_losses.approve_post'],
      ['exportHistoricalPlatformLossBatch', 'admin.page.historical_platform_losses.export'],
    ] as const;
    for (const [method, permission] of expected) {
      expect(Reflect.getMetadata(ADMIN_PERMISSION_KEY, AdminController.prototype[method]))
        .toEqual([permission]);
    }
  });
});

describe('AdminService - historical platform loss audit', () => {
  let billingClient: {
    createHistoricalPlatformLossBatch: jest.Mock;
    approveAndPostHistoricalPlatformLossBatch: jest.Mock;
    exportHistoricalPlatformLossBatch: jest.Mock;
  };
  let activityLog: { log: jest.Mock };
  let service: AdminService;

  beforeEach(() => {
    billingClient = {
      createHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ id: 'batch-1', status: 'PREPARED' }),
      approveAndPostHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ id: 'batch-1', status: 'POSTED' }),
      exportHistoricalPlatformLossBatch: jest.fn().mockResolvedValue({ schemaVersion: 'historical-platform-loss-export.v1' }),
    };
    activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    service = new AdminService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getOrThrow: jest.fn().mockReturnValue('secret') } as never,
      activityLog as never,
      {} as never,
      billingClient as never,
      {} as never,
    );
  });

  it('audits prepare without copying all source lines into the audit detail', async () => {
    const body = {
      ...commonBody(),
      expectedFingerprint: 'b'.repeat(64),
      idempotencyKey: 'prepare-1',
    } as never;
    await service.createHistoricalPlatformLossBatch(body, 'maker-1');

    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'maker-1',
      action: 'historical_platform_loss.prepare',
      resourceId: 'batch-1',
      detail: expect.objectContaining({
        sourceFileSha256: 'A'.repeat(64),
        itemCount: 1,
        financialImpact: false,
      }),
    }));
    expect(activityLog.log.mock.calls[0][0].detail.lines).toBeUndefined();
  });

  it('audits the zero-customer-impact approval and export', async () => {
    const approval = {
      expectedRevision: 0,
      expectedFingerprint: 'b'.repeat(64),
      reason: 'approved FIN-42',
      idempotencyKey: 'approve-1',
    };
    await service.approveAndPostHistoricalPlatformLossBatch('batch-1', approval, 'checker-1');
    await service.exportHistoricalPlatformLossBatch('batch-1', 'finance-2');

    expect(activityLog.log).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'historical_platform_loss.approve_post',
      detail: expect.objectContaining({
        customerDeduction: false,
        issuedInvoicesChanged: false,
        customerBalanceChanged: false,
      }),
    }));
    expect(activityLog.log).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'historical_platform_loss.export',
      adminMemberId: 'finance-2',
    }));
  });
});
