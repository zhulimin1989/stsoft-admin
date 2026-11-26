import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VerificationInfoSheet } from '../VerificationInfoSheet';
import { certStatusTag, certTypeLabel } from '../formatters';

describe('VerificationInfoSheet', () => {
  it('identifies assisted source from the actual snapshot without customer payment or personal status',()=>{
    render(<VerificationInfoSheet verification={{id:'ver-admin',type:'ENTERPRISE',status:'VERIFIED',creationSource:'ADMIN_ASSISTED',verificationMethod:'ADMIN_OFFLINE',paymentMode:'ADMIN_WAIVED'}}/>);
    expect(screen.getByText('后台代办')).toBeInTheDocument();expect(screen.getByText('运营线下核实')).toBeInTheDocument();expect(screen.getByText('免客户打款')).toBeInTheDocument();expect(screen.queryByText('打款金额')).not.toBeInTheDocument();
  });
  it('renders 认证态 user section with PRD field order and labels', () => {
    render(
      <VerificationInfoSheet
        verification={{
          id: 'ver-1',
          type: 'ENTERPRISE',
          status: 'VERIFIED',
          enterpriseName: '上海简图影视文化工作室',
          uscc: '91310117MA1J1PJL2C',
          legalPersonName: null,
          channel: null,
          verifiedAt: null,
        }}
      />,
    );

    expect(screen.getByText('认证态')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('已认证')).toBeInTheDocument();
    expect(screen.getByText('企业实名认证')).toBeInTheDocument();
    expect(screen.getByText('统一社会信用代码')).toBeInTheDocument();
    expect(screen.getByText('实名 ID')).toBeInTheDocument();
    expect(screen.getByText('ver-1')).toBeInTheDocument();
    expect(screen.getByText('上海简图影视文化工作室')).toBeInTheDocument();
    const colgroup = document.querySelector('colgroup.ea-v2-desc-cols');
    expect(colgroup).not.toBeNull();
    expect(colgroup?.querySelectorAll('col')).toHaveLength(4);
  });

  it('falls back to account snapshot when verification is missing', () => {
    render(
      <VerificationInfoSheet
        verification={null}
        account={{
          id: 'ba-1',
          enterpriseName: '回落企业',
          uscc: '91110000FALLBACK01',
          verificationId: 'ver-fallback',
        }}
      />,
    );

    expect(screen.getByText('回落企业')).toBeInTheDocument();
    expect(screen.getByText('91110000FALLBACK01')).toBeInTheDocument();
    expect(screen.getByText('ver-fallback')).toBeInTheDocument();
    expect(screen.getByText('企业实名认证')).toBeInTheDocument();
    expect(screen.getByText('未认证')).toBeInTheDocument();
  });
});

describe('certStatusTag / certTypeLabel', () => {
  it('maps verification statuses to PRD copy', () => {
    expect(certTypeLabel('ENTERPRISE')).toBe('企业实名认证');
    const verified = render(certStatusTag('VERIFIED'));
    expect(verified.getByText('已认证')).toBeInTheDocument();
    verified.unmount();
    const reviewing = render(certStatusTag('PENDING'));
    expect(reviewing.getByText('审核中')).toBeInTheDocument();
    reviewing.unmount();
    const none = render(certStatusTag(null));
    expect(none.getByText('未认证')).toBeInTheDocument();
  });
});
