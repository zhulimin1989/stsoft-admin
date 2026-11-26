import { App as AntdApp } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelDetailPage from '../detail';

const mocks = vi.hoisted(() => ({
  listModels: vi.fn(),
  upsertModel: vi.fn(),
  listChannels: vi.fn(),
}));

vi.mock('../../../api/admin', () => ({
  modelPricingApi: {
    list: mocks.listModels,
    upsert: mocks.upsertModel,
  },
  channelApi: {
    list: mocks.listChannels,
  },
}));

vi.mock('../../../contexts/PlatformConfigContext', () => ({
  usePlatformCurrency: () => 'USD',
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => true,
}));

function renderDetail(path: string) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/models/:id" element={<ModelDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

describe('ModelDetailPage save semantics', () => {
  beforeAll(() => {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  beforeEach(() => {
    mocks.listModels.mockReset();
    mocks.upsertModel.mockReset();
    mocks.listChannels.mockReset();
    mocks.listChannels.mockResolvedValue({ items: [], total: 0 });
  });

  it('loads the legacy modelId as the display name and preserves the calling model ID', async () => {
    mocks.listModels.mockResolvedValue({
      items: [
        {
          id: 'model-record-1',
          modelName: 'old-model-name',
          modelId: 'Old display name',
          inputPricePerMToken: 1,
          outputPricePerMToken: 2,
          isActive: true,
        },
      ],
    });
    mocks.upsertModel.mockResolvedValue({
      id: 'model-record-1',
      modelName: 'old-model-name',
      displayName: 'New display name',
    });

    renderDetail('/models/model-record-1');
    const user = userEvent.setup();
    const nameInput = await screen.findByDisplayValue('old-model-name');
    const displayNameInput = screen.getByDisplayValue('Old display name');

    expect(nameInput).toBeDisabled();
    expect(screen.getByLabelText('Model ID')).toBe(nameInput);
    expect(screen.getByLabelText('名称')).toBe(displayNameInput);
    await user.clear(displayNameInput);
    await user.type(displayNameInput, 'New display name');
    await user.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mocks.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'old-model-name',
          modelId: 'New display name',
        }),
      );
    });
    expect(mocks.upsertModel.mock.calls[0][0]).not.toHaveProperty('displayName');
  });

  it('clears the display name without changing the channel-facing model name', async () => {
    mocks.listModels.mockResolvedValue({
      items: [
        {
          id: 'model-record-1',
          modelName: 'old-model-name',
          displayName: 'Old display name',
          inputPricePerMToken: 1,
          outputPricePerMToken: 2,
          isActive: true,
        },
      ],
    });
    mocks.upsertModel.mockResolvedValue({
      id: 'model-record-1',
      modelName: 'old-model-name',
      displayName: null,
    });

    renderDetail('/models/model-record-1');
    const user = userEvent.setup();
    const displayNameInput = await screen.findByDisplayValue('Old display name');

    await user.clear(displayNameInput);
    await user.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mocks.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'old-model-name',
          modelId: null,
        }),
      );
    });
  });

  it('does not persist the derived displayName fallback when stored modelId is null', async () => {
    mocks.listModels.mockResolvedValue({
      items: [
        {
          id: 'model-record-1',
          modelName: 'old-model-name',
          modelId: null,
          displayName: 'old-model-name',
          inputPricePerMToken: 1,
          outputPricePerMToken: 2,
          isActive: true,
        },
      ],
    });
    mocks.upsertModel.mockResolvedValue({
      id: 'model-record-1',
      modelName: 'old-model-name',
    });

    renderDetail('/models/model-record-1');
    const user = userEvent.setup();

    await screen.findByDisplayValue('old-model-name');
    expect(screen.getByLabelText('名称')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mocks.upsertModel).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.upsertModel.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.modelName).toBe('old-model-name');
    expect(payload).not.toHaveProperty('modelId');
  });

  it('creates a new record with separate calling and display names', async () => {
    mocks.upsertModel.mockResolvedValue({
      id: 'model-record-2',
      modelName: 'brand-new-model',
      displayName: 'Brand New Model',
    });

    renderDetail('/models/new');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('gpt-4o-mini'), 'brand-new-model');
    await user.type(screen.getByPlaceholderText('例如：GPT-4o Mini'), 'Brand New Model');
    await user.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mocks.upsertModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'brand-new-model',
          modelId: 'Brand New Model',
        }),
      );
    });
  });
});
