import { useEffect, useRef, useState } from 'react';
import { Alert, Button, List, Space, Tag, Typography } from 'antd';
import type { EnterpriseAdminHistory, EnterpriseAdminHistoryEvent } from '@ruidong/shared';
import { creationError, enterpriseAdminCreationApi as api } from '../../api/v2/enterpriseAdminCreations';
import { actionLabels } from './formatters';
export function RecordHistory({requestId,operatorId}:{requestId:string;operatorId:string}){
  const [items,setItems]=useState<EnterpriseAdminHistoryEvent[]>([]),[cursor,setCursor]=useState<EnterpriseAdminHistory['nextCursor']>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0),abort=useRef<AbortController|null>(null),alive=useRef(true);
  async function load(older=false){
    const seq=++sequence.current;abort.current?.abort();const ctrl=new AbortController();abort.current=ctrl;setBusy(true);setError('');
    try{const value=await api.history(requestId,{limit:20,...(older&&cursor?{beforeId:cursor.id,beforeAt:cursor.createdAt}:{})},ctrl.signal);
      if(!alive.current||seq!==sequence.current)return;setItems(prev=>older?[...prev,...value.items]:value.items);setCursor(value.nextCursor);
    }catch(e){if(alive.current&&seq===sequence.current)setError(creationError(e).message);}
    finally{if(alive.current&&seq===sequence.current)setBusy(false);}
  }
  useEffect(()=>{alive.current=true;setItems([]);setCursor(null);void load();return()=>{alive.current=false;++sequence.current;abort.current?.abort();};},[requestId,operatorId]);
  return <section aria-label="原记录操作历史"><Space wrap style={{marginBottom:12}}><Typography.Text strong>操作历史</Typography.Text><Button disabled={busy} onClick={()=>void load()}>刷新历史</Button></Space>
    {error&&<Alert type="warning" message="操作历史暂时无法读取" description={error}/>}
    <List loading={busy} dataSource={items} locale={{emptyText:error?'尚未核实历史':'暂无已记录事件'}} renderItem={event=><List.Item key={event.id}><div>
      <Space wrap><Typography.Text>{actionLabels[event.action]||'操作事件'}</Typography.Text><Typography.Text type="secondary">{new Date(event.createdAt).toLocaleString()}</Typography.Text>{event.errorCode&&<Tag color="warning">{event.errorCode}</Tag>}</Space>
      <div><Typography.Text type="secondary">操作来源：{event.operatorType==='ADMIN'?'运营':event.operatorType==='SYSTEM'?'系统':'未知'}{event.operatorId?' · '+event.operatorId:''}{event.provisioningStatus?' · '+event.provisioningStatus:''}{event.attempts!==null?' · 执行次数 '+event.attempts:''}</Typography.Text></div>
    </div></List.Item>}/>
    {cursor&&<Button disabled={busy} onClick={()=>void load(true)}>查看更早的事件</Button>}
  </section>;
}
