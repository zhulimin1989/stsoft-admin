import { afterEach, describe, expect, it, vi } from 'vitest';
import { warnNonCritical } from '../logging';

describe('warnNonCritical', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs scope and error without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('network');

    warnNonCritical('ProductSwitcher', error);

    expect(warn).toHaveBeenCalledWith('[ProductSwitcher] non-critical operation failed', error);
  });
});
