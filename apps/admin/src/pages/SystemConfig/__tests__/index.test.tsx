import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemConfigPage from '../index';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  setCurrency: vi.fn(),
}));

vi.mock('../../../api/admin', () => ({
  systemConfigApi: {
    get: mocks.get,
    update: mocks.update,
  },
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => true,
}));

vi.mock('../../../contexts/PlatformConfigContext', () => ({
  usePlatformConfig: () => ({ setCurrency: mocks.setCurrency }),
}));

const domesticConfig = {
  basicInfo: { siteName: '睿动' },
  emailConfig: { smtpPort: 587 },
  platformConfig: { region: 'domestic', currency: 'cny', defaultLanguage: 'zh' },
  oauthConfig: {},
  apiGatewayConfig: {},
  storageConfig: { provider: 's3' },
  logConfig: {},
  maintenanceConfig: {},
};

describe('SystemConfigPage loading guard', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.update.mockReset();
    mocks.setCurrency.mockReset();
  });

  it('does not render editable defaults when config loading fails', async () => {
    mocks.get.mockRejectedValue(new Error('network unavailable'));

    render(<SystemConfigPage />);

    expect(await screen.findByText('系统配置加载失败')).toBeInTheDocument();
    expect(screen.getByText(/network unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('keeps editing blocked for an empty response and can retry a real config', async () => {
    mocks.get
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(domesticConfig);

    render(<SystemConfigPage />);

    expect(await screen.findByText('系统配置加载失败')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重试加载/ }));

    expect(await screen.findByText('平台运行时')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('系统配置加载失败')).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: /保存/ }).length).toBeGreaterThan(0);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});
