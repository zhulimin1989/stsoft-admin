import { describe, expect, it } from 'vitest';
import {
  canRetryPublisherSyncStatus,
  isRetiredPublisherSyncStatus,
  PUBLISHER_SYNC_RETIRED_STATUSES,
} from './publisherSyncStatus';

describe('Publisher sync retired statuses', () => {
  it.each(PUBLISHER_SYNC_RETIRED_STATUSES)('treats %s as a retired terminal status', (status) => {
    expect(isRetiredPublisherSyncStatus(status)).toBe(true);
  });

  it('does not retire current retryable statuses', () => {
    expect(isRetiredPublisherSyncStatus('FAILED')).toBe(false);
    expect(isRetiredPublisherSyncStatus('PENDING')).toBe(false);
  });

  it('only allows retryable current statuses', () => {
    expect(canRetryPublisherSyncStatus('FAILED')).toBe(true);
    expect(canRetryPublisherSyncStatus('PENDING')).toBe(true);
    expect(canRetryPublisherSyncStatus('PROCESSING')).toBe(false);
    expect(canRetryPublisherSyncStatus('SUCCEEDED')).toBe(false);
    for (const status of PUBLISHER_SYNC_RETIRED_STATUSES) {
      expect(canRetryPublisherSyncStatus(status)).toBe(false);
    }
  });
});
