import { useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth-store';
import { getDefaultAdminRoute } from '../../config/permissions';

export default function LoginPage() {
  const { login, user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  if (user) {
    return <Navigate to={getDefaultAdminRoute(user.resolvedPermissions)} replace />;
  }

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      const nextUser = await login(values.email, values.password);
      message.success('登录成功');
      navigate(getDefaultAdminRoute(nextUser.resolvedPermissions), { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8f5f1',
    }}>
      <Card style={{ width: 400 }} variant="borderless">
        <h1 style={{ textAlign: 'center', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          睿动 · 管理后台
        </h1>
        <p style={{ textAlign: 'center', color: '#6B7280', marginBottom: 32, fontSize: 13 }}>
          管理员登录
        </p>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }]}>
            <Input placeholder="admin@example.com" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="输入密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
