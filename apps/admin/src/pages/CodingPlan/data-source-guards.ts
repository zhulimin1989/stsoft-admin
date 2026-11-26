import type {
  CodingPlanDataSourceState,
  CodingPlanFulfillmentMode,
  CodingPlanWorkspace,
} from '../../api/admin';

type BlockingSourceKey = 'modelAccess' | 'quotaTemplates' | 'upstreamProducts';

export interface CodingPlanDataSourceIssue {
  key: BlockingSourceKey;
  label: string;
  status: string;
  owner: string;
  message: string;
}

const SOURCE_LABELS: Record<BlockingSourceKey, string> = {
  modelAccess: '模型授权',
  quotaTemplates: '配额模板',
  upstreamProducts: '上游产品目录',
};

export function codingPlanWriteSourceKeys(
  mode: CodingPlanFulfillmentMode,
): BlockingSourceKey[] {
  return mode === 'provider_resale'
    ? []
    : ['modelAccess', 'quotaTemplates'];
}

export function codingPlanDataSourceIssues(
  workspace: CodingPlanWorkspace | null,
  mode: CodingPlanFulfillmentMode,
): CodingPlanDataSourceIssue[] {
  if (!workspace) return [];
  return codingPlanWriteSourceKeys(mode)
    .map((key) => {
      const source = workspace.dataSources[key] as CodingPlanDataSourceState | undefined;
      if (!source || source.status === 'ready') return null;
      return {
        key,
        label: SOURCE_LABELS[key],
        status: source.status,
        owner: source.owner,
        message: source.message || '数据源暂不可用',
      };
    })
    .filter((issue): issue is CodingPlanDataSourceIssue => Boolean(issue));
}

export function formatCodingPlanDataSourceIssues(
  issues: CodingPlanDataSourceIssue[],
): string {
  return issues
    .map((issue) => `${issue.label}: ${issue.status} - ${issue.message}`)
    .join('；');
}
