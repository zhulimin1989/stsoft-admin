import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyPlaceholder } from '../EmptyPlaceholder';

describe('EmptyPlaceholder', () => {
  it('renders title and description', () => {
    render(<EmptyPlaceholder title="功能开发中" description="后端接口即将就绪" />);
    expect(screen.getByText('功能开发中')).toBeInTheDocument();
    expect(screen.getByText('后端接口即将就绪')).toBeInTheDocument();
  });

  it('renders action when provided', () => {
    render(
      <EmptyPlaceholder
        title="x"
        description="y"
        action={<button>了解更多</button>}
      />,
    );
    expect(screen.getByText('了解更多')).toBeInTheDocument();
  });

  it('renders todo list when provided', () => {
    render(
      <EmptyPlaceholder
        title="x"
        description="y"
        todos={['第一项', '第二项']}
      />,
    );
    expect(screen.getByText('第一项')).toBeInTheDocument();
    expect(screen.getByText('第二项')).toBeInTheDocument();
  });
});
