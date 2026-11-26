import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { ENTERPRISE_ADMIN_PERMISSION, ENTERPRISE_ADMIN_PUBLIC_STATUSES, enterpriseAdminListSchema, type EnterpriseAdminCreationRecord } from '@ruidong/shared';
import { PageHeader, DataTable } from '../../components/common';
import { usePermission } from '../../hooks/usePermission';
import { useAuthStore } from '../../stores/auth-store';
import { enterpriseAdminCreationApi as api, creationError } from '../../api/v2/enterpriseAdminCreations';
import { CreationEntry } from '../EnterpriseAdminCreation/CreationEntry';
import { markerKey } from '../EnterpriseAdminCreation/useCreationFlow';
import { statusLabels } from './formatters';
export default function EnterpriseAdminRecordsPage(){
  const allowed=usePermission(ENTERPRISE_ADMIN_PERMISSION),operatorId=useAuthStore(s=>s.user?.id);
  if(!allowed||!operatorId)return <Navigate to="/403" replace/>;
  return <Records key={operatorId} operatorId={operatorId}/>;
}
function Records({operatorId}:{operatorId:string}){
  const [params,setParams]=useSearchParams(),location=useLocation(),navigate=useNavigate(),[form]=Form.useForm();
  const [data,setData]=useState<{items:EnterpriseAdminCreationRecord[];total:number}>({items:[],total:0}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[version,setVersion]=useState(0),sequence=useRef(0);
  const page=Math.max(1,parseInt(params.get('acPage')||'1',10)||1),pageSize=Math.min(100,Math.max(1,parseInt(params.get('acPageSize')||'20',10)||20));
  const status=params.get('acStatus')||undefined,requestId=params.get('acRequestId')||undefined,ownerUserId=params.get('acOwnerId')||undefined,uscc=params.get('acUscc')||undefined;
  useEffect(()=>{form.setFieldsValue({status,requestId,ownerUserId,uscc});},[form,status,requestId,ownerUserId,uscc]);
  useEffect(()=>{
    const seq=++sequence.current,abort=new AbortController();setBusy(true);setError('');setData({items:[],total:0});
    const query=enterpriseAdminListSchema.safeParse({page,pageSize,status,requestId,ownerUserId,uscc});
    if(!query.success){setError(query.error.issues[0]?.message||'筛选格式不正确');setBusy(false);return;}
    api.list(query.data,abort.signal).then(value=>{if(sequence.current===seq)setData(value);}).catch(e=>{if(sequence.current===seq)setError(creationError(e).message);}).finally(()=>{if(sequence.current===seq)setBusy(false);});
    return()=>{++sequence.current;abort.abort();};
  },[operatorId,page,pageSize,status,requestId,ownerUserId,uscc,version]);
  function filter(values:Record<string,string|undefined>){
    const query=enterpriseAdminListSchema.safeParse({page:1,pageSize,status:values.status||undefined,requestId:values.requestId?.trim()||undefined,ownerUserId:values.ownerUserId?.trim()||undefined,uscc:values.uscc?.trim()||undefined});
    if(!query.success){setError(query.error.issues[0]?.message||'筛选格式不正确');return;}
    const next=new URLSearchParams(params),fields:Array<[string,string|undefined]>=[['acStatus',query.data.status],['acRequestId',query.data.requestId],['acOwnerId',query.data.ownerUserId],['acUscc',query.data.uscc]];
    for(const [key,value] of fields){if(value)next.set(key,value);else next.delete(key);}next.delete('acPage');setParams(next);
  }
  let originalMarker=false;try{originalMarker=Boolean(localStorage.getItem(markerKey(operatorId)));}catch{originalMarker=true;}
  return <div>
    <PageHeader title="代办记录" subtitle="后台代办受理及开通记录，按原请求查看结果与操作历史。" actions={[<CreationEntry key="create"/>,<Button key="list" onClick={()=>navigate(`/enterprise-accounts-v2${location.search}`)}>返回企业账户</Button>]}/>
    {originalMarker&&<Alert style={{marginBottom:16}} type="info" message="此浏览器保存了一次原创建操作" action={<Button onClick={()=>navigate(`/enterprise-accounts-v2/admin-create${location.search}`)}>续查原创建操作</Button>}/>}
    <Form form={form} layout="inline" onFinish={filter} style={{rowGap:12,marginBottom:16}} autoComplete="off">
      <Form.Item name="status" label="开通状态"><Select aria-label="开通状态" allowClear style={{width:180}} options={ENTERPRISE_ADMIN_PUBLIC_STATUSES.map(value=>({value,label:statusLabels[value]}))}/></Form.Item>
      <Form.Item name="requestId" label="请求 ID"><Input aria-label="精确请求 ID" placeholder="精确请求 ID" maxLength={64}/></Form.Item>
      <Form.Item name="ownerUserId" label="受理时 Owner ID"><Input aria-label="精确 Owner ID" placeholder="精确用户 ID" maxLength={64}/></Form.Item>
      <Form.Item name="uscc" label="统一社会信用代码"><Input aria-label="精确信用代码" placeholder="18 位大写信用代码" maxLength={64}/></Form.Item>
      <Space wrap><Button htmlType="submit" type="primary">查询记录</Button><Button onClick={()=>{form.resetFields();filter({});}}>重置筛选</Button><Button loading={busy} onClick={()=>setVersion(v=>v+1)}>刷新记录</Button></Space>
    </Form>
    {error&&<Alert type="warning" showIcon message="代办记录未能核实" description={error} style={{marginBottom:16}}/>}
    <DataTable<EnterpriseAdminCreationRecord> rowKey="requestId" loading={busy} dataSource={data.items} scroll={{x:'max-content'}} locale={{emptyText:error?'当前无法读取记录，请重新核实':'暂无匹配的代办记录'}}
      listPagination={{current:page,pageSize,total:data.total,onChange:(p,size)=>{const next=new URLSearchParams(params);next.set('acPage',String(p));next.set('acPageSize',String(size));setParams(next);}}}
      columns={[
        {title:'企业名称',dataIndex:'enterpriseName',render:value=>value||'—'},
        {title:'统一社会信用代码',dataIndex:'uscc',render:value=>value||'—'},
        {title:'受理时 Owner',render:(_,row)=><><Typography.Text>{row.ownerUserId}</Typography.Text><div>{row.ownerPhoneMasked}</div></>},
        {title:'操作人',dataIndex:'createdByAdminId'},
        {title:'受理时间',dataIndex:'createdAt',render:value=>new Date(value).toLocaleString()},
        {title:'来源 / 付款方式',render:()=> <Space direction="vertical"><Tag>后台代办</Tag><Typography.Text>线下核实 / 免客户打款</Typography.Text></Space>},
        {title:'开通状态',dataIndex:'publicStatus',render:value=>statusLabels[value as keyof typeof statusLabels]},
        {title:'操作',render:(_,row)=><Button type="link" onClick={()=>navigate(`/enterprise-accounts-v2/admin-creations/${row.requestId}${location.search}`)}>查看原记录</Button>},
      ]}/>
  </div>;
}
