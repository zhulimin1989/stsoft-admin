import { BadRequestException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ADMIN_PERMISSION_KEY } from '../common/decorators/admin-permission.decorator';

describe('AdminController - Gateway billing evidence actions', () => {
  const action = {
    expectedRevision: 4,
    reason: '  incident FIN-42 approved  ',
    idempotencyKey: '  gateway-action-42  ',
  };
  let service: {
    listGatewayBillingEvents: jest.Mock;
    getGatewayBillingEvent: jest.Mock;
    retryGatewayBillingEvent: jest.Mock;
    markGatewayBillingEventManualReview: jest.Mock;
    reconcileAndSettleGatewayBillingEvent: jest.Mock;
    absorbGatewayBillingEvent: jest.Mock;
    absorbGatewayBillingEventDelta: jest.Mock;
  };
  let controller: AdminController;

  beforeEach(() => {
    service = {
      listGatewayBillingEvents: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getGatewayBillingEvent: jest.fn(),
      retryGatewayBillingEvent: jest.fn().mockResolvedValue({ reconciliationStatus: 'PROCESSING' }),
      markGatewayBillingEventManualReview: jest.fn().mockResolvedValue({ reconciliationStatus: 'MANUAL_REVIEW' }),
      reconcileAndSettleGatewayBillingEvent: jest.fn().mockResolvedValue({ fundingOutcome: 'COLLECTED' }),
      absorbGatewayBillingEvent: jest.fn().mockResolvedValue({ fundingOutcome: 'ABSORBED' }),
      absorbGatewayBillingEventDelta: jest.fn().mockResolvedValue({ fundingOutcome: 'ABSORBED' }),
    };
    controller = new AdminController(service as never);
  });

  it('passes tenant filters and the exact Billing detail payload through the Admin API', async () => {
    const detail = {
      requestId: 'request-1',
      tenantId: 'tenant-1',
      occurredAt: '2026-08-07T00:00:00.000Z',
      platformLossEntries: [{
        id: 'platform-loss-1',
        customerDeductionUsd: '0.000000000000',
        platformLossUsd: '0.300000000003',
      }],
    };
    service.getGatewayBillingEvent.mockResolvedValue(detail);

    await controller.listGatewayBillingEvents({
      page: '1',
      pageSize: '20',
      tenantId: 'tenant-1',
      evidenceVerdict: 'VERIFIED_PROVIDER_CORRECTION',
      fundingOutcome: 'RECEIVABLE',
    });
    const response = await controller.getGatewayBillingEvent('request-1');

    expect(service.listGatewayBillingEvents).toHaveBeenCalledWith(1, 20, {
      tenantId: 'tenant-1',
      evidenceVerdict: 'VERIFIED_PROVIDER_CORRECTION',
      fundingOutcome: 'RECEIVABLE',
    });
    expect(response.data).toBe(detail);
    expect((response.data as typeof detail).platformLossEntries[0].platformLossUsd)
      .toBe('0.300000000003');
  });

  it('requires and normalizes revision, reason and idempotency key for every action', async () => {
    await controller.retryGatewayBillingEvent('request/1', action, 'operator-1');
    await controller.markGatewayBillingEventManualReview('request/1', action, 'finance-1');
    await controller.reconcileAndSettleGatewayBillingEvent(
      'request/1',
      { evidenceId: '  evidence-1  ', ...action },
      'finance-1',
    );
    await controller.absorbGatewayBillingEvent('request/1', action, 'finance-1');
    await controller.absorbGatewayBillingEventDelta(
      'request/1',
      { evidenceId: '  evidence-2  ', ...action },
      'finance-1',
    );

    const normalized = {
      expectedRevision: 4,
      reason: 'incident FIN-42 approved',
      idempotencyKey: 'gateway-action-42',
    };
    expect(service.retryGatewayBillingEvent).toHaveBeenCalledWith('request/1', normalized, 'operator-1');
    expect(service.markGatewayBillingEventManualReview).toHaveBeenCalledWith('request/1', normalized, 'finance-1');
    expect(service.reconcileAndSettleGatewayBillingEvent).toHaveBeenCalledWith(
      'request/1',
      { evidenceId: 'evidence-1', ...normalized },
      'finance-1',
    );
    expect(service.absorbGatewayBillingEvent).toHaveBeenCalledWith('request/1', normalized, 'finance-1');
    expect(service.absorbGatewayBillingEventDelta).toHaveBeenCalledWith(
      'request/1',
      { evidenceId: 'evidence-2', ...normalized },
      'finance-1',
    );
  });

  it('preserves the explicit unanchored currency repair proof as one protocol unit', async () => {
    const manifestHash = 'a'.repeat(64);
    await controller.absorbGatewayBillingEvent('request/1', {
      ...action,
      protocol: 'gateway-unanchored-absorb-v1',
      currencyRepairRunId: '  repair-run-1  ',
      currencyRepairItemId: '  repair-item-1  ',
      manifestHash,
    }, 'finance-1');

    expect(service.absorbGatewayBillingEvent).toHaveBeenCalledWith('request/1', {
      expectedRevision: 4,
      reason: 'incident FIN-42 approved',
      idempotencyKey: 'gateway-action-42',
      protocol: 'gateway-unanchored-absorb-v1',
      currencyRepairRunId: 'repair-run-1',
      currencyRepairItemId: 'repair-item-1',
      manifestHash,
    }, 'finance-1');
  });

  it.each([
    { ...action, protocol: 'gateway-unanchored-absorb-v2' },
    { ...action, currencyRepairRunId: 'repair-run-1' },
    {
      ...action,
      protocol: 'gateway-unanchored-absorb-v1',
      currencyRepairRunId: 'repair-run-1',
      currencyRepairItemId: 'repair-item-1',
      manifestHash: 'not-a-sha256',
    },
  ])('rejects partial or unknown absorb protocols at the Admin boundary', async (body) => {
    await expect(
      controller.absorbGatewayBillingEvent('request-1', body, 'finance-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.absorbGatewayBillingEvent).not.toHaveBeenCalled();
  });

  it.each([
    { ...action },
    { evidenceId: '   ', ...action },
    { evidenceId: 'evidence-1', ...action, expectedRevision: -1 },
  ])('rejects an unsafe settlement body before calling Billing', async (body) => {
    await expect(
      controller.reconcileAndSettleGatewayBillingEvent('request-1', body, 'finance-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.reconcileAndSettleGatewayBillingEvent).not.toHaveBeenCalled();
    await expect(
      controller.absorbGatewayBillingEventDelta('request-1', body, 'finance-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.absorbGatewayBillingEventDelta).not.toHaveBeenCalled();
  });

  it('keeps delta absorption behind the existing finance absorb permission', () => {
    expect(Reflect.getMetadata(
      ADMIN_PERMISSION_KEY,
      AdminController.prototype.absorbGatewayBillingEventDelta,
    )).toEqual(['admin.page.gateway_billing_events.absorb']);
  });

  it.each([
    undefined,
    {},
    { expectedRevision: -1, reason: 'reason', idempotencyKey: 'key' },
    { expectedRevision: 1.5, reason: 'reason', idempotencyKey: 'key' },
    { expectedRevision: 1, reason: '   ', idempotencyKey: 'key' },
    { expectedRevision: 1, reason: 'reason', idempotencyKey: '   ' },
  ])('rejects an unsafe action body before calling Billing', async (body) => {
    await expect(
      controller.retryGatewayBillingEvent('request-1', body, 'operator-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.retryGatewayBillingEvent).not.toHaveBeenCalled();
  });
});

describe('AdminService - Gateway billing evidence audit', () => {
  const action = {
    expectedRevision: 6,
    reason: 'approved incident FIN-42',
    idempotencyKey: 'gateway-action-6',
  };
  let billingClient: {
    getGatewayEvent: jest.Mock;
    listGatewayEvents: jest.Mock;
    retryGatewayEvent: jest.Mock;
    markGatewayEventManualReview: jest.Mock;
    reconcileAndSettleGatewayEvent: jest.Mock;
    absorbGatewayEvent: jest.Mock;
    absorbGatewayEventDelta: jest.Mock;
  };
  let activityLog: { log: jest.Mock };
  let service: AdminService;

  beforeEach(() => {
    billingClient = {
      getGatewayEvent: jest.fn(),
      listGatewayEvents: jest.fn(),
      retryGatewayEvent: jest.fn().mockResolvedValue({ revision: 7 }),
      markGatewayEventManualReview: jest.fn().mockResolvedValue({ revision: 7 }),
      reconcileAndSettleGatewayEvent: jest.fn().mockResolvedValue({
        revision: 7,
        fundingOutcome: 'COLLECTED',
      }),
      absorbGatewayEvent: jest.fn().mockResolvedValue({ revision: 7, fundingOutcome: 'ABSORBED' }),
      absorbGatewayEventDelta: jest.fn().mockResolvedValue({
        revision: 8,
        fundingOutcome: 'ABSORBED',
      }),
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

  it('passes exact platform-loss strings and occurrence identity through without coercion', async () => {
    const detail = {
      id: 'event-1',
      requestId: 'request-1',
      tenantId: 'tenant-1',
      occurredAt: '2026-08-07T00:00:00.000Z',
      evidenceVerdict: 'VERIFIED_PROVIDER_CORRECTION',
      fundingOutcome: 'RECEIVABLE',
      platformLossEntries: [{
        id: 'platform-loss-1',
        customerChargeBeforeUsd: '0.100000000001',
        customerChargeCorrectedUsd: '0.400000000004',
        absorbedCustomerChargeUsd: '0.300000000003',
        customerDeductionUsd: '0.000000000000',
        providerCostBeforeUsd: '0.200000000001',
        providerCostCorrectedUsd: '0.500000000004',
        providerCostDeltaUsd: '0.300000000003',
        platformLossUsd: '0.300000000003',
      }],
    };
    billingClient.getGatewayEvent.mockResolvedValue(detail);

    await expect(service.getGatewayBillingEvent('request-1')).resolves.toBe(detail);
    expect(billingClient.getGatewayEvent).toHaveBeenCalledWith('request-1');
    expect(detail.platformLossEntries[0].platformLossUsd).toBe('0.300000000003');
  });

  it.each([
    ['retry', 'retryGatewayEvent', 'retryGatewayBillingEvent'],
    ['manual_review', 'markGatewayEventManualReview', 'markGatewayBillingEventManualReview'],
    ['absorb', 'absorbGatewayEvent', 'absorbGatewayBillingEvent'],
  ] as const)('forwards and audits the %s action', async (auditAction, clientMethod, serviceMethod) => {
    await service[serviceMethod]('request-1', action, 'admin-1');

    expect(billingClient[clientMethod]).toHaveBeenCalledWith('request-1', action);
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'admin-1',
      action: `gateway_billing_event.${auditAction}`,
      resource: 'GatewayBillingEvent',
      resourceId: 'request-1',
      detail: auditAction === 'absorb'
        ? {
            ...action,
            financialImpact: true,
            customerDeduction: false,
            protocol: 'gateway-absorb-v2',
          }
        : action,
    }));
  });

  it('forwards and audits the complete unanchored currency repair protocol', async () => {
    const repairAbsorb = {
      ...action,
      protocol: 'gateway-unanchored-absorb-v1' as const,
      currencyRepairRunId: 'repair-run-1',
      currencyRepairItemId: 'repair-item-1',
      manifestHash: 'a'.repeat(64),
    };

    await service.absorbGatewayBillingEvent('request-1', repairAbsorb, 'finance-1');

    expect(billingClient.absorbGatewayEvent)
      .toHaveBeenCalledWith('request-1', repairAbsorb);
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'finance-1',
      operatorAdminId: 'finance-1',
      action: 'gateway_billing_event.absorb',
      resource: 'GatewayBillingEvent',
      resourceId: 'request-1',
      detail: {
        ...action,
        financialImpact: true,
        customerDeduction: false,
        protocol: 'gateway-unanchored-absorb-v1',
        currencyRepairRunId: 'repair-run-1',
        currencyRepairItemId: 'repair-item-1',
        manifestHash: repairAbsorb.manifestHash,
      },
    }));
  });

  it('forwards the selected evidence and audits the financial settlement', async () => {
    const settlement = { evidenceId: 'evidence-1', ...action };

    await service.reconcileAndSettleGatewayBillingEvent(
      'request-1',
      settlement,
      'finance-1',
    );

    expect(billingClient.reconcileAndSettleGatewayEvent)
      .toHaveBeenCalledWith('request-1', settlement);
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'finance-1',
      operatorAdminId: 'finance-1',
      action: 'gateway_billing_event.reconcile_settle',
      resource: 'GatewayBillingEvent',
      resourceId: 'request-1',
      detail: {
        ...settlement,
        financialImpact: true,
      },
    }));
  });

  it('forwards the correction evidence and audits zero-customer-deduction delta absorption', async () => {
    const delta = { evidenceId: 'evidence-2', ...action };

    await service.absorbGatewayBillingEventDelta('request-1', delta, 'finance-1');

    expect(billingClient.absorbGatewayEventDelta).toHaveBeenCalledWith('request-1', delta);
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'finance-1',
      operatorAdminId: 'finance-1',
      action: 'gateway_billing_event.absorb_delta',
      resource: 'GatewayBillingEvent',
      resourceId: 'request-1',
      detail: {
        ...delta,
        financialImpact: true,
        customerDeduction: false,
      },
    }));
  });
});
