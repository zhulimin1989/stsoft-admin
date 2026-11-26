import { Link } from 'react-router-dom';
import { Result, Button } from 'antd';

export default function ForbiddenPage() {
  return (
    <Result
      status="403"
      title="403"
      subTitle="您没有访问此页面的权限"
      extra={
        <Link to="/">
          <Button type="primary">返回首页</Button>
        </Link>
      }
    />
  );
}
