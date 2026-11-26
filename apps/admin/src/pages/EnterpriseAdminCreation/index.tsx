import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Space, Tag, Typography } from 'antd';
import { ENTERPRISE_ADMIN_PERMISSION } from '@ruidong/shared';
import { PageHeader } from '../../components/common';
import { useAuthStore } from '../../stores/auth-store';
import { usePermission } from '../../hooks/usePermission';
import { creationReason } from '../../api/v2/enterpriseAdminCreations';
import { useCreationCapabilities } from './useCreationCapabilities';
import { useCreationFlow } from './useCreationFlow';
import './creation.css';
import { CreationResolver } from '../EnterpriseAdminRecords/CreationResolver';

export default function EnterpriseAdminCreationPage() {
  const allowed=usePermission(ENTERPRISE_ADMIN_PERMISSION);
  const operatorId=useAuthStore(s=>s.user?.id);
  if(!allowed||!operatorId)return <Navigate to="/403" replace />;
  return <CreationForm key={operatorId} operatorId={operatorId} />;
}
function CreationForm({operatorId}:{operatorId:string}) {
  const navigate=useNavigate(),location=useLocation();
  const {capabilities,failed}=useCreationCapabilities(true);
  const f=useCreationFlow(operatorId,capabilities?.licenseMaxBytes,Boolean(capabilities?.enabled));
  const back=()=>navigate(`/enterprise-accounts-v2${location.search}`);
  return <div className="enterprise-creation">
    <PageHeader title="代客创建企业账户" subtitle="录入已线下核实的企业资料，关联已注册且正常的企业 Owner。" actions={[<Button key="records" onClick={()=>navigate(`/enterprise-accounts-v2/admin-creations${location.search}`)}>查看代办记录</Button>,<Button key="back" onClick={back}>返回企业账户</Button>]} />
    {f.marker ? <Card>
      <Alert showIcon type={f.marker.state==='ACCEPTED'?'info':'warning'}
        message={f.sending?'正在提交':f.marker.state==='ACCEPTED'?'已受理':'提交结果待确认'}
        description={f.marker.state==='ACCEPTED'?'请求已保存，后台将继续开通。已受理不代表企业已开通。':'本次提交可能已被受理，已保留原操作标识。请核实原请求后再处理，当前不能再次创建。'} />
      <Descriptions column={1} style={{marginTop:24}}>
        {f.marker.requestId&&<Descriptions.Item label="请求 ID"><Typography.Text copyable>{f.marker.requestId}</Typography.Text></Descriptions.Item>}
        <Descriptions.Item label="本次操作标识"><Typography.Text copyable>{f.marker.idempotencyKey}</Typography.Text></Descriptions.Item>
      </Descriptions>
      {f.error&&<Alert type="warning" message={f.error} style={{marginBottom:16}} />}
      {f.marker.state==='UNKNOWN'&&<CreationResolver operatorId={operatorId} idempotencyKey={f.marker.idempotencyKey} sending={f.sending} onFound={f.acceptResolved}/>}
      <Space wrap><Button onClick={back}>返回企业账户</Button>{f.marker.requestId&&<Button type="primary" onClick={()=>navigate(`/enterprise-accounts-v2/admin-creations/${f.marker!.requestId}${location.search}`)}>查看开通结果</Button>}{f.marker.state==='ACCEPTED'&&<Button disabled={!capabilities?.enabled} onClick={f.newCreation}>创建另一家企业</Button>}</Space>
    </Card> : <>
      {!capabilities&&<Alert showIcon type={failed?'error':'info'} message={failed?'创建能力暂时无法确认，请稍后重新进入':'正在确认创建能力'} />}
      {capabilities&&!capabilities.enabled&&<Alert showIcon type="warning" message="当前暂不开放代客创建" />}
      <Form layout="vertical" autoComplete="off" disabled={f.disabled} className="enterprise-creation-form" onFinish={()=>void f.confirm()}>
        <div className="enterprise-creation-grid">
          <Card title="企业资料">
            <Form.Item label="企业名称" required validateStatus={f.errorField==='enterpriseName'?'error':undefined} help={f.errorField==='enterpriseName'?f.error:undefined}><Input aria-label="企业名称" maxLength={129} value={f.enterpriseName} onChange={e=>f.edit('enterpriseName',e.target.value)} placeholder="与营业执照一致，2～128 位" /></Form.Item>
            <Form.Item label="统一社会信用代码" required validateStatus={f.errorField==='uscc'?'error':undefined} help={f.errorField==='uscc'?f.error:undefined}><Input aria-label="统一社会信用代码" maxLength={64} value={f.uscc} onChange={e=>f.edit('uscc',e.target.value)} placeholder="18 位大写字母或数字" /></Form.Item>
            <Form.Item label="营业执照" required validateStatus={f.errorField==='license'?'error':undefined} help={f.errorField==='license'?f.error:undefined}>
              <input aria-label="选择营业执照" type="file" disabled={f.disabled} accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={e=>{const file=e.target.files?.[0]||null;e.target.value='';void f.selectFile(file);}} />
              <Typography.Paragraph type="secondary" style={{marginTop:12}}>{capabilities?`支持 JPG / JPEG / PNG / PDF，最大 ${capabilities.licenseMaxBytes>=1048576?`${capabilities.licenseMaxBytes/1048576} MiB`:`${capabilities.licenseMaxBytes} 字节`}。上传有效期 ${capabilities.uploadTtlSeconds%60===0?`${capabilities.uploadTtlSeconds/60} 分钟`:`${capabilities.uploadTtlSeconds} 秒`}。`:'上传规则将在服务可用后显示。'}</Typography.Paragraph>
              {f.uploadBusy&&<Space><Tag color="processing">执照上传中</Tag><Button onClick={()=>void f.selectFile(null)}>移除执照</Button></Space>}
              {f.upload&&<div className="enterprise-creation-file">
                <Typography.Text>{f.fileName}</Typography.Text><Tag color={f.expired?'error':'success'}>{f.expired?'已过期，请重新上传':'已上传'}</Tag>
                <Typography.Text type="secondary">{(f.upload.size/1024).toFixed(1)} KiB · 有效至 {new Date(f.upload.expiresAt).toLocaleString()}</Typography.Text>
                <Space wrap><Button disabled={f.expired} loading={f.previewBusy} onClick={()=>void f.viewFile()}>私有预览</Button><Button onClick={()=>void f.selectFile(null)}>移除执照</Button></Space>
              </div>}
            </Form.Item>
          </Card>
          <Card title="关联企业 Owner">
            <Form.Item label="客户提供的手机号" required validateStatus={f.errorField==='phone'?'error':undefined} help={f.errorField==='phone'?f.error:undefined}><Input aria-label="客户提供的手机号" maxLength={64} value={f.phone} onChange={e=>f.edit('phone',e.target.value)} placeholder="输入已注册账号的大陆手机号" /></Form.Item>
            <Button onClick={()=>void f.lookup()} loading={f.lookupBusy} disabled={f.disabled||!f.phone.trim()}>精确查找账号</Button>
            {f.owner&&<div style={{marginTop:20}}>
              {f.owner.owner&&<Descriptions column={1} size="small"><Descriptions.Item label="昵称">{f.owner.owner.nickname||'—'}</Descriptions.Item><Descriptions.Item label="用户 ID">{f.owner.owner.userId}</Descriptions.Item><Descriptions.Item label="手机号">{f.owner.owner.phoneMasked||'—'}</Descriptions.Item></Descriptions>}
              <Alert showIcon type={f.owner.eligible?'success':'warning'} message={f.owner.eligible?'该账号可作为企业 Owner':creationReason(f.owner.reasonCode)} />
            </div>}
            <Typography.Paragraph type="secondary" style={{marginTop:20}}>仅选择已注册、正常且符合企业 Owner 条件的账号；普通企业成员身份与 Owner 身份分别核验。</Typography.Paragraph>
          </Card>
        </div>
        {f.error&&!f.errorField&&<Alert showIcon type="error" message={f.error} style={{marginTop:16}} />}
        <div className="enterprise-creation-footer"><Button disabled={false} onClick={back}>取消</Button><Button type="primary" htmlType="submit" disabled={!f.canConfirm} loading={f.checking}>核对提交资料</Button></div>
      </Form>
    </>}
    <Modal title="提交前核对" open={Boolean(f.confirmation)} onCancel={f.returnToEdit} footer={[<Button key="edit" onClick={f.returnToEdit}>返回修改</Button>,<Button key="submit" type="primary" disabled={f.disabled||f.expired} loading={f.sending} onClick={()=>void f.submit()}>确认并提交</Button>]}>
      {f.confirmation&&<><Descriptions column={1}><Descriptions.Item label="企业名称">{f.confirmation.input.enterpriseName}</Descriptions.Item><Descriptions.Item label="统一社会信用代码">{f.confirmation.input.uscc}</Descriptions.Item><Descriptions.Item label="企业 Owner">{f.confirmation.nickname}</Descriptions.Item><Descriptions.Item label="用户 ID">{f.confirmation.input.ownerUserId}</Descriptions.Item><Descriptions.Item label="手机号">{f.confirmation.phoneMasked}</Descriptions.Item><Descriptions.Item label="营业执照">{f.confirmation.fileName}</Descriptions.Item></Descriptions><Alert type="info" message="提交时会再次核验主体、账号和执照；受理后由后台继续开通。" /></>}
    </Modal>
    <Modal title="营业执照私有预览" open={Boolean(f.preview)} onCancel={f.clearPreview} footer={<Button onClick={f.clearPreview}>关闭预览</Button>} width={800}>
      {f.preview&&(f.preview.type==='application/pdf'?<iframe title="营业执照 PDF" src={f.preview.url} sandbox="" className="enterprise-creation-preview" />:<img alt="营业执照" src={f.preview.url} className="enterprise-creation-preview" />)}
    </Modal>
  </div>;
}
