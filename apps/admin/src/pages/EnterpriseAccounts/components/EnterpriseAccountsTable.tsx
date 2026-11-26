import { Button, Space } from 'antd';
import {
  CreditCardOutlined,
  LinkOutlined,
  PayCircleOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import { DataTable, type TablePaginationState } from '../../../components/common';
import type { EnterpriseAccount } from '../../../api/v2/enterpriseAccounts';
import {
  accountStatusTag,
  fmtDateTime,
  formatMoneyCents,
} from '../formatters';

interface EnterpriseAccountsTableProps {
  rows: EnterpriseAccount[];
  loading: boolean;
  pagination: TablePaginationState;
  selectedRowKey?: string;
  canManage: boolean;
  currency: string;
  onOpenDetail: (account: EnterpriseAccount) => void;
  onRecharge: (account: EnterpriseAccount) => void;
  onConfigureCredit: (account: EnterpriseAccount) => void;
  onConfigureDiscount: (account: EnterpriseAccount) => void;
  onAttachTenant: (account: EnterpriseAccount) => void;
}

export function EnterpriseAccountsTable({
  rows,
  loading,
  pagination,
  selectedRowKey,
  canManage,
  currency,
  onOpenDetail,
  onRecharge,
  onConfigureCredit,
  onConfigureDiscount,
  onAttachTenant,
}: EnterpriseAccountsTableProps) {
  return (
    <DataTable<EnterpriseAccount>
      rowKey="id"
      loading={loading}
      dataSource={rows}
      onRowClick={onOpenDetail}
      selectedRowKey={selectedRowKey}
      listPagination={pagination}
      columns={[
        {
          title: '企业名称',
          dataIndex: 'enterpriseName',
          key: 'enterpriseName',
          render: (_: unknown, row) => row.enterpriseName || row.name || '—',
        },
        {
          title: '统一社会信用代码',
          dataIndex: 'uscc',
          key: 'uscc',
          render: (value: string | null) => value || '—',
        },
        {
          title: 'Owner 用户',
          dataIndex: 'ownerUserId',
          key: 'ownerUserId',
          render: (value: string | null) => value || '—',
        },
        {
          title: '账户状态',
          dataIndex: 'status',
          key: 'status',
          render: (value: string | null) => accountStatusTag(value),
        },
        {
          title: '信用额度',
          key: 'credit',
          render: (_: unknown, row) =>
            row.credit ? formatMoneyCents(row.credit.limitCents, currency) : '—',
        },
        {
          title: '创建时间',
          dataIndex: 'createdAt',
          key: 'createdAt',
          render: (value: string | null) => fmtDateTime(value),
        },
        {
          title: '操作',
          key: 'ops',
          render: (_: unknown, row) => (
            <Space>
              <Button
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDetail(row);
                }}
              >
                详情
              </Button>
              {canManage && (
                <>
                  <Button
                    size="small"
                    icon={<PayCircleOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRecharge(row);
                    }}
                  >
                    充值
                  </Button>
                  <Button
                    size="small"
                    icon={<CreditCardOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onConfigureCredit(row);
                    }}
                  >
                    信用额度
                  </Button>
                  <Button
                    size="small"
                    icon={<PercentageOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onConfigureDiscount(row);
                    }}
                  >
                    专属折扣
                  </Button>
                  <Button
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAttachTenant(row);
                    }}
                  >
                    挂载 tenant
                  </Button>
                </>
              )}
            </Space>
          ),
        },
      ]}
    />
  );
}
