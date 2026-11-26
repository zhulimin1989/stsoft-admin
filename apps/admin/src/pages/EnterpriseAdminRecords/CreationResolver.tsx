import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { enterpriseAdminCreationApi as api, creationError } from '../../api/v2/enterpriseAdminCreations';
import { uuid } from '../../api/v2/enterpriseAdminRecordValidation';
import { pollDelay } from './useVerifiedRecord';
export function CreationResolver({operatorId,idempotencyKey,sending,onFound}:{operatorId:string;idempotencyKey:string;sending:boolean;onFound:(requestId:string)=>boolean}){
  const navigate=useNavigate(),location=useLocation(),[message,setMessage]=useState('等待核实原幂等请求'),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),seq=useRef(0),found=useRef(onFound);found.current=onFound;
  useEffect(()=>{
    if(sending||!uuid(idempotencyKey))return;
    const generation=++seq.current,abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,count=0;
    const current=()=>seq.current===generation&&!abort.signal.aborted;
    async function resolve(){
      if(!current())return;setBusy(true);
      try{const value=await api.resolve(idempotencyKey,abort.signal);if(!current())return;
        if(value.found&&value.record){if(value.record.createdByAdminId!==operatorId){setMessage('原请求运营关联不一致，请人工核查');return;}
          if(found.current(value.record.requestId))navigate(`/enterprise-accounts-v2/admin-creations/${value.record.requestId}${location.search}`,{replace:true});return;}
        setMessage('尚未查到原请求，仍需等待核实；保留原键，不重新创建。');
      }catch(error){if(!current())return;const e=creationError(error);setMessage(e.message+'；原提交继续待确认');if(e.status===401||e.status===403)return;}
      finally{if(current())setBusy(false);}
      if(current()&&++count<10)timer=setTimeout(resolve,pollDelay(count));
    }
    void resolve();return()=>{++seq.current;abort.abort();if(timer)clearTimeout(timer);};
  },[operatorId,idempotencyKey,sending,version,navigate,location.search]);
  if(!uuid(idempotencyKey))return <Alert type="warning" message="原操作标识无法读取，请联系支持人员核查原记录。不要通过清除浏览器存储重新创建。"/>;
  return <Space direction="vertical" style={{marginBottom:16,width:'100%'}}><Alert type="warning" message={message}/><Button loading={busy} disabled={sending} onClick={()=>{++seq.current;setVersion(v=>v+1);}}>按原幂等键核实</Button></Space>;
}
