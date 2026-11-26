import { Button, DatePicker, Input, Select } from 'antd';
import dayjs from 'dayjs';
import type {
  FinanceReportFilterField,
  FinanceReportFilterOption,
} from './financeReportFilters';

interface FinanceReportQueryBarProps {
  month: string;
  filterOptions: readonly FinanceReportFilterOption[];
  filterField?: FinanceReportFilterField;
  filterValue: string;
  loading?: boolean;
  hasAppliedFilter?: boolean;
  onMonthChange: (month: string) => void;
  onFilterFieldChange: (field: FinanceReportFilterField) => void;
  onFilterValueChange: (value: string) => void;
  onQuery: () => void;
  onClearFilter: () => void;
}

export function FinanceReportQueryBar({
  month,
  filterOptions,
  filterField,
  filterValue,
  loading = false,
  hasAppliedFilter = false,
  onMonthChange,
  onFilterFieldChange,
  onFilterValueChange,
  onQuery,
  onClearFilter,
}: FinanceReportQueryBarProps) {
  const activeOption = filterOptions.find((item) => item.value === filterField)
    ?? filterOptions[0];
  const supportsFiltering = filterOptions.length > 0;

  return (
    <div className="finance-report-query-bar" role="search" aria-label="财务报表查询条件">
      <div className="finance-report-query-control">
        <span className="finance-report-query-label">账期月份</span>
        <DatePicker
          picker="month"
          allowClear={false}
          value={dayjs(month)}
          onChange={(value) => onMonthChange((value ?? dayjs()).format('YYYY-MM'))}
          aria-label="账期月份"
        />
      </div>

      {supportsFiltering ? (
        <>
          <div className="finance-report-query-control">
            <span className="finance-report-query-label">查询字段</span>
            <Select
              aria-label="查询字段"
              value={activeOption?.value}
              options={filterOptions.map((item) => ({
                label: item.label,
                value: item.value,
              }))}
              onChange={onFilterFieldChange}
              className="finance-report-query-field"
            />
          </div>
          <div className="finance-report-query-control finance-report-query-value">
            <span className="finance-report-query-label">查询内容</span>
            <Input
              allowClear
              aria-label="查询内容"
              placeholder={activeOption?.placeholder ?? '请输入查询内容'}
              value={filterValue}
              onChange={(event) => onFilterValueChange(event.target.value)}
              onPressEnter={onQuery}
            />
          </div>
        </>
      ) : null}

      <div className="finance-report-query-actions">
        <Button type="primary" onClick={onQuery} loading={loading}>
          查询
        </Button>
        {supportsFiltering ? (
          <Button
            onClick={onClearFilter}
            disabled={!filterValue.trim() && !hasAppliedFilter}
          >
            清空筛选
          </Button>
        ) : null}
      </div>
    </div>
  );
}
