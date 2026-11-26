import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Result, Button, Space } from 'antd';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Result
          status="error"
          title="页面出现错误"
          subTitle={this.state.error?.message || '发生了未知错误'}
          extra={
            <Space>
              <Button type="primary" onClick={() => window.location.reload()}>
                刷新页面
              </Button>
              <Button onClick={() => (window.location.href = '/')}>
                返回首页
              </Button>
            </Space>
          }
        />
      </div>
    );
  }
}
