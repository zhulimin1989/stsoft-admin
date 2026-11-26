import { Button } from 'antd';
import { DataTable, type TablePaginationState } from '../../../components/common';
import type { ReviewApplication } from '../../../api/v2/enterpriseAccounts';
import {
  fmtDateTime,
  formatCnyAmount,
  provisioningTag,
  reviewTag,
} from '../formatters';

interface ReviewApplicationsTableProps {
  rows: ReviewApplication[];
  loading: boolean;
  pagination: TablePaginationState;
  selectedRowKey?: string;
  onOpenDetail: (application: ReviewApplication) => void;
}

export function ReviewApplicationsTable({
  rows,
  loading,
  pagination,
  selectedRowKey,
  onOpenDetail,
}: ReviewApplicationsTableProps) {
  return (
    <DataTable<ReviewApplication>
      rowKey="applicationId"
      loading={loading}
      dataSource={rows}
      onRowClick={onOpenDetail}
      selectedRowKey={selectedRowKey}
      listPagination={pagination}
      columns={[
        {
          title: '申请编号',
          dataIndex: 'applicationNo',
          key: 'applicationNo',
          render: (value: string | null) => value || '—',
        },
        {
          title: '企业名称',
          dataIndex: 'enterpriseName',
          key: 'enterpriseName',
          render: (value: string | null) => value || '—',
        },
        {
          title: '统一社会信用代码',
          dataIndex: 'uscc',
          key: 'uscc',
          render: (value: string | null) => value || '—',
        },
        {
          title: '审核状态',
          dataIndex: 'reviewStatus',
          key: 'reviewStatus',
          render: (value: string | null) => reviewTag(value),
        },
        {
          title: '开通状态',
          dataIndex: 'provisioningStatus',
          key: 'provisioningStatus',
          render: (value: string | null) => provisioningTag(value),
        },
        {
          title: '打款金额',
          dataIndex: 'paymentAmount',
          key: 'paymentAmount',
          render: (value: number | string | null) => formatCnyAmount(value),
        },
        {
          title: '提交时间',
          dataIndex: 'paymentSubmittedAt',
          key: 'paymentSubmittedAt',
          render: (value: string | null) => fmtDateTime(value),
        },
        {
          title: '操作',
          key: 'ops',
          render: (_: unknown, row) => (
            <Button
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDetail(row);
              }}
            >
              审核详情
            </Button>
          ),
        },
      ]}
    />
  );
}
