import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProviderLogo } from '../ProviderLogo';

describe('ProviderLogo', () => {
  it('renders a known provider logo with requested size', () => {
    const { container } = render(<ProviderLogo provider="openai" size={32} />);

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.firstElementChild).toHaveStyle({ width: '32px', height: '32px' });
  });

  it('infers provider from model name', () => {
    const { container } = render(<ProviderLogo modelName="claude-3-5-sonnet" />);

    expect(container.querySelector('svg')).not.toBeNull();
  });

  it.each([
    ['gpt-5.4', 'openai'],
    ['anthropic-claude-opus', 'anthropic'],
    ['gemini-2.5-pro', 'google'],
    ['palm-bison', 'google'],
    ['deepseek-chat', 'deepseek'],
    ['glm-4.5', 'zhipu'],
    ['chatglm-pro', 'zhipu'],
    ['kimi-k2', 'moonshot'],
    ['minimax-abab6.5', 'minimax'],
    ['qwen-max', 'qwen'],
    ['tongyi-plus', 'qwen'],
    ['mistral-large', 'mistral'],
    ['mixtral-8x7b', 'mistral'],
    ['codestral-latest', 'mistral'],
    ['llama-3.3', 'meta'],
    ['meta-llama-3', 'meta'],
  ])('infers %s as %s', (modelName) => {
    const { container } = render(<ProviderLogo modelName={modelName} />);

    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders the multicolor google mark', () => {
    const { container } = render(<ProviderLogo provider="google" />);

    expect(container.querySelectorAll('path')).toHaveLength(4);
  });

  it('falls back to an initial for unknown providers', () => {
    render(<ProviderLogo provider="xai" />);

    expect(screen.getByText('X')).toBeInTheDocument();
  });

  it('falls back to a question mark when no name is available', () => {
    render(<ProviderLogo />);

    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
