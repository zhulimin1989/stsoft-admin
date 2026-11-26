export const PUBLISHER_SYNC_RETIRED_STATUSES = [
  'LEGACY_PROVIDER_PUBLISH_RETIRED',
  'RUNTIME_INTENT_V1_RETIRED',
  'LEGACY_KEY_POOL_PUBLISH_RETIRED',
  'DEDICATED_KEY_META_V1_RETIRED',
] as const;

const retiredStatuses = new Set<string>(PUBLISHER_SYNC_RETIRED_STATUSES);

export const RETIRED_PUBLISHER_SYNC_RETRY_MESSAGE =
  '旧版本任务已退役，请从当前状态执行全量重推';

export function isRetiredPublisherSyncStatus(status: string): boolean {
  return retiredStatuses.has(status);
}

export function canRetryPublisherSyncStatus(status: string): boolean {
  return !isRetiredPublisherSyncStatus(status)
    && status !== 'SUCCEEDED'
    && status !== 'PROCESSING';
}
