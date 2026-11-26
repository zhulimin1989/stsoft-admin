import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Modal, Space, Tag, Typography } from 'antd';
import { ENTERPRISE_ADMIN_PERMISSION } from '@ruidong/shared';
import { PageHeader } from '../../components/common';
import { useAuthStore } from '../../stores/auth-store';
import { usePermission } from '../../hooks/usePermission';
import { uuid } from '../../api/v2/enterpriseAdminRecordValidation';
import { useVerifiedRecord } from './useVerifiedRecord';
import { useRecordAction } from './useRecordAction';
import { usePrivateLicense } from './usePrivateLicense';
import { RecordHistory } from './RecordHistory';
import { statusLabels } from './formatters';
import '../EnterpriseAdminCreation/creation.css';
export default function EnterpriseCreationResultPage(){
  const {requestId=''}=useParams(),operatorId=useAuthStore(s=>s.user?.id),allowed=usePermission(ENTERPRISE_ADMIN_PERMISSION);
  if(!allowed||!operatorId)return <Navigate to="/403" replace/>;
  if(!uuid(requestId))return <Alert type="error" message="请求标识格式不正确"/>;
  return <Result key={operatorId+'/'+requestId} requestId={requestId} operatorId={operatorId}/>;
}
function Result({requestId,operatorId}:{requestId:string;operatorId:string}){
  const navigation=useNavigate(),location=useLocation(),canView=usePermission('admin.page.enterprise_accounts.view');
  const state=useVerifiedRecord(requestId,operatorId),action=useRecordAction(requestId,operatorId,state.refresh),file=usePrivateLicense(requestId,operatorId);
  const current=!state.busy&&!state.error&&Boolean(state.record),record=state.record;
  const canRetry=current&&record?.canRetry&&record.recovery?.kind==='RETRY';
  const canRecover=current&&record?.recovery?.action==='RECOVER_ORIGINAL'&&['REPAIR_MISSING_JOB','SETTLE_ACTIVE'].includes(record.recovery.kind);
  const pending=action.marker?.state==='UNKNOWN',actionDisabled=action.busy||action.storageError;
  return <div className="enterprise-creation">
    <PageHeader title="代办记录与开通结果" subtitle="按原请求核实企业工作区、Owner 与计费账户的开通状态。" actions={[<Button key="records" onClick={()=>navigation(`/enterprise-accounts-v2/admin-creations${location.search}`)}>返回代办记录</Button>]}/>
    <Card style={{marginBottom:20}}>
      <Alert showIcon type={state.error?'warning':current&&record?.publicStatus==='SUCCEEDED'?'success':current&&record?.publicStatus.startsWith('FAILED')?'warning':'info'}
        message={state.error?'当前无法核实开通状态':state.busy?'正在核实当前状态':record?statusLabels[record.publicStatus]:'等待核实原请求'}
        description={state.error?`${state.error}${record&&state.observedAt?`；上次核实：${statusLabels[record.publicStatus]}（${new Date(state.observedAt).toLocaleString()}）`:''}`:current&&record?.publicStatus==='SUCCEEDED'?'企业开通资源已由服务端核实完整。':record?.errorMessage||'后台继续处理，离开本页不会取消原任务。'}/>
      <Descriptions column={1} style={{marginTop:16}}><Descriptions.Item label="请求 ID"><Typography.Text copyable>{requestId}</Typography.Text></Descriptions.Item></Descriptions>
      <Space wrap><Button loading={state.busy} onClick={state.refresh}>刷新当前状态</Button><Button loading={file.busy} onClick={()=>void file.view()}>查看原营业执照</Button><Button disabled={action.busy} onClick={()=>void action.inspect()}>核实恢复资格与当前 Owner</Button>
        {canView&&current&&record?.publicStatus==='SUCCEEDED'&&record.billingAccountId&&<Button onClick={()=>navigation(`/enterprise-accounts-v2/${record.billingAccountId}${location.search}`)}>查看企业账户详情</Button>}
      </Space>
      {state.paused&&<Typography.Paragraph type="secondary" style={{marginTop:12}}>自动查询已暂停，可手动刷新原记录。</Typography.Paragraph>}
      {file.error&&<Alert style={{marginTop:12}} type="warning" message={file.error}/>}
    </Card>
    <Card title="原记录处理" style={{marginBottom:20}}>
      {record?.recovery&&<Alert type={record.recovery.kind==='UNKNOWN'?'warning':'info'} message={record.recovery.message}/>}
      {action.report&&<Descriptions column={1} style={{marginTop:12}}><Descriptions.Item label="核实时间">{new Date(action.report.observedAt).toLocaleString()}</Descriptions.Item><Descriptions.Item label="当前 Owner（本次核实）">{action.report.currentOwnerUserId||'暂不可确认'}</Descriptions.Item></Descriptions>}
      {action.message&&<Alert style={{marginTop:12}} type={pending?'warning':'info'} message={action.message}/>}
      {action.storageError&&<Alert type="warning" message="本地操作标识无法核实，已阻止新动作，请核查原请求。"/>}
      {action.marker&&<Typography.Paragraph style={{marginTop:12}}>原动作操作 ID：<Typography.Text copyable>{action.marker.operationId}</Typography.Text>{pending&&<Tag color="warning">结果待确认</Tag>}</Typography.Paragraph>}
      <Space wrap style={{marginTop:12}}>
        {pending?<><Button disabled={actionDisabled} onClick={()=>void action.checkReceipt()}>核对原动作回执</Button><Button disabled={actionDisabled||!current||record?.recovery?.kind==='UNKNOWN'} onClick={()=>void action.execute(action.marker!.action,true)}>重发原动作（保留操作 ID）</Button></>:
          <>{canRetry&&<Button disabled={actionDisabled} loading={action.busy} onClick={()=>void action.execute('retry')}>重试原记录</Button>}{canRecover&&<Button disabled={actionDisabled} loading={action.busy} onClick={()=>void action.execute('recover')}>{record?.recovery?.kind==='SETTLE_ACTIVE'?'结算原任务':'恢复原初次任务'}</Button>}</>}
      </Space>
      {current&&record?.publicStatus==='FAILED_MANUAL'&&<Typography.Paragraph style={{marginTop:12}}>请核查原申请、主体和资源归属；需管理处置时联系具备原管理权限的人员。保留原请求，不重新创建企业。</Typography.Paragraph>}
    </Card>
    {record&&<Card title="受理资料快照" style={{marginBottom:20}}><Descriptions column={{xs:1,sm:1,md:2}} bordered size="small">
      <Descriptions.Item label="企业名称">{record.enterpriseName||'—'}</Descriptions.Item><Descriptions.Item label="统一社会信用代码">{record.uscc||'—'}</Descriptions.Item>
      <Descriptions.Item label="受理时 Owner">{record.ownerUserId}</Descriptions.Item><Descriptions.Item label="受理时手机号">{record.ownerPhoneMasked}</Descriptions.Item>
      <Descriptions.Item label="操作人">{record.createdByAdminId}</Descriptions.Item><Descriptions.Item label="受理时间">{new Date(record.createdAt).toLocaleString()}</Descriptions.Item>
      <Descriptions.Item label="创建来源">后台代办</Descriptions.Item><Descriptions.Item label="核实 / 付款方式">运营线下核实 / 免客户打款</Descriptions.Item>
      <Descriptions.Item label="开通主区 ID">{record.tenantId||'尚未核实'}</Descriptions.Item><Descriptions.Item label="企业计费账户 ID">{record.billingAccountId||'尚未核实'}</Descriptions.Item>
    </Descriptions></Card>}
    <Card><RecordHistory requestId={requestId} operatorId={operatorId}/></Card>
    <Modal title="原营业执照私有预览" open={Boolean(file.preview)} onCancel={file.close} footer={<Button onClick={file.close}>关闭预览</Button>} width={800}>
      {file.preview&&(file.preview.type==='application/pdf'?<iframe title="原营业执照 PDF" src={file.preview.url} sandbox="" className="enterprise-creation-preview"/>:<img alt="原营业执照" src={file.preview.url} className="enterprise-creation-preview"/>)}
    </Modal>
  </div>;
}
