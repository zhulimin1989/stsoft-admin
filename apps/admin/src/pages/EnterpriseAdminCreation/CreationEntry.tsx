import { Button } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { ENTERPRISE_ADMIN_PERMISSION } from '@ruidong/shared';
import { usePermission } from '../../hooks/usePermission';
import { useCreationCapabilities } from './useCreationCapabilities';

export function CreationEntry() {
  const allowed=usePermission(ENTERPRISE_ADMIN_PERMISSION), {capabilities}=useCreationCapabilities(allowed);
  const location=useLocation(), navigate=useNavigate();
  if(!allowed||!capabilities?.enabled)return null;
  return <Button type="primary" icon={<PlusOutlined />} onClick={()=>navigate(`/enterprise-accounts-v2/admin-create${location.search}`)}>代客创建企业账户</Button>;
}
