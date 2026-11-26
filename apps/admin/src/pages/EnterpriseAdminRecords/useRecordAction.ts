import { useEffect, useRef, useState } from 'react';
import type { EnterpriseAdminRecoveryReport } from '@ruidong/shared';
import { creationError, enterpriseAdminCreationApi as api } from '../../api/v2/enterpriseAdminCreations';
import { uuid } from '../../api/v2/enterpriseAdminRecordValidation';
import { secureRandomUuid } from '../../utils/secureRandomUuid';
export interface ActionMarker {requestId:string;action:'retry'|'recover';operationId:string;state:'UNKNOWN'|'ACCEPTED'|'REJECTED'}
export const actionMarkerKey=(operatorId:string,requestId:string)=>`admin.enterprise-action.v1.${operatorId}.${requestId}`;
function read(key:string,requestId:string):ActionMarker|null{
  const raw=localStorage.getItem(key);if(!raw)return null;const v=JSON.parse(raw);
  if(v?.requestId!==requestId||!uuid(v.operationId)||!['retry','recover'].includes(v.action)||!['UNKNOWN','ACCEPTED','REJECTED'].includes(v.state))throw Error('invalid action marker');
  return {requestId,action:v.action,operationId:v.operationId,state:v.state};
}
export function useRecordAction(requestId:string,operatorId:string,onAccepted:()=>void){
  const key=actionMarkerKey(operatorId,requestId),[marker,setMarker]=useState<ActionMarker|null>(null),[storageError,setStorageError]=useState(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[report,setReport]=useState<EnterpriseAdminRecoveryReport|null>(null);
  const latch=useRef(false),generation=useRef(0),alive=useRef(true),queryAbort=useRef<AbortController|null>(null);
  useEffect(()=>{
    alive.current=true;try{setMarker(read(key,requestId));}catch{setStorageError(true);}
    const changed=(event:StorageEvent)=>{if(event.key===key){try{setMarker(read(key,requestId));}catch{setStorageError(true);}}};
    window.addEventListener('storage',changed);return()=>{alive.current=false;++generation.current;queryAbort.current?.abort();window.removeEventListener('storage',changed);};
  },[key,requestId]);
  function save(value:ActionMarker,expectedOperationId:string|null){
    const current=read(key,requestId);
    // A late response/receipt must not erase a newer original action selected in another tab.
    if((current?.operationId??null)!==expectedOperationId){if(alive.current){setMarker(current);setMessage('此浏览器已有另一操作，请先核实当前操作标识');}return false;}
    localStorage.setItem(key,JSON.stringify(value));if(alive.current)setMarker(value);return true;
  }
  async function inspect(){
    const seq=++generation.current;queryAbort.current?.abort();const abort=new AbortController();queryAbort.current=abort;
    try{const value=await api.recovery(requestId,abort.signal);if(alive.current&&seq===generation.current){setReport(value);setMessage(value.decision.message);}return value;}
    catch(error){if(alive.current&&seq===generation.current)setMessage(creationError(error).message);return null;}
  }
  async function checkReceipt(){
    if(latch.current||storageError)return;let pending:ActionMarker|null;
    try{pending=read(key,requestId);}catch{setStorageError(true);return;}if(!pending)return;
    latch.current=true;setBusy(true);queryAbort.current?.abort();const abort=new AbortController();queryAbort.current=abort;const seq=++generation.current;
    try{const history=await api.history(requestId,{limit:100,operationId:pending.operationId},abort.signal);
      if(!alive.current||seq!==generation.current)return;
      const accepted=history.items.some(e=>e.operatorId===operatorId&&(pending!.action==='retry'?e.action==='RETRY_QUEUED':['RECOVERY_JOB_REPAIRED','RECOVERY_JOB_SETTLED'].includes(e.action)));
      const rejected=history.items.some(e=>e.operatorId===operatorId&&e.action===(pending!.action==='retry'?'RETRY_REJECTED':'RECOVERY_REJECTED'));
      if(accepted){if(save({...pending,state:'ACCEPTED'},pending.operationId)){setMessage('原动作已受理，正在核实当前开通状态');onAccepted();}}
      else if(rejected&&!history.hasMore){if(save({...pending,state:'REJECTED'},pending.operationId)){setMessage('原动作有拒绝记录，请重新核实当前资格');onAccepted();}}
      else {setMessage('尚未确认原动作回执，保留原操作 ID。请核实当前状态后再处理。');await inspect();}
    }catch(error){if(alive.current&&seq===generation.current)setMessage(creationError(error).message);}
    finally{latch.current=false;if(alive.current)setBusy(false);}
  }
  async function execute(action:'retry'|'recover',replay=false){
    if(latch.current||storageError)return;latch.current=true;setBusy(true);setMessage('');
    let operation:ActionMarker|null=null;
    try{
      let previous:ActionMarker|null;
      try{previous=read(key,requestId);}catch{setStorageError(true);setMessage('本地操作标识无法核实，未发送动作');return;}
      if(previous?.state==='UNKNOWN'&&!replay){setMarker(previous);setMessage('请先核实原动作，不能开始第二次操作');return;}
      if(replay&&(!previous||previous.state!=='UNKNOWN'||previous.action!==action))return;
      // Fetch fresh business facts before the user-requested action; the write still rechecks on the server.
      const eligibility=await api.recovery(requestId);
      if(!alive.current)return;setReport(eligibility);
      const eligible=action==='retry'?eligibility.decision.kind==='RETRY':['REPAIR_MISSING_JOB','SETTLE_ACTIVE'].includes(eligibility.decision.kind);
      if(eligibility.decision.kind==='UNKNOWN'||(!replay&&!eligible)){setMessage(eligibility.decision.message);onAccepted();return;}
      operation=replay?previous!:{requestId,action,operationId:secureRandomUuid(),state:'UNKNOWN'};
      try{if(!save(operation,previous?.operationId??null))return;}catch{setStorageError(true);setMessage('无法保存操作 ID，未发送动作');return;}
      // Same network action always uses the original operation UUID; response 202 is not completion proof.
      await api[action](requestId,operation.operationId);
      const saved=save({...operation,state:'ACCEPTED'},operation.operationId);if(alive.current){if(saved)setMessage('操作已受理，正在核实当前开通状态');onAccepted();}
    }catch(error){const e=creationError(error);
      if(operation&&e.status!==null&&[400,409].includes(e.status)&&e.code&&e.code!=='ENTERPRISE_ADMIN_IDEMPOTENCY_CONFLICT'){
        try{save({...operation,state:'REJECTED'},operation.operationId);}catch{if(alive.current)setStorageError(true);}
      }
      if(alive.current){setMessage(operation?'原动作结果需核实：'+e.message:e.message);onAccepted();}
    }finally{latch.current=false;if(alive.current)setBusy(false);}
  }
  return {marker,storageError,busy,message,report,inspect,checkReceipt,execute};
}
