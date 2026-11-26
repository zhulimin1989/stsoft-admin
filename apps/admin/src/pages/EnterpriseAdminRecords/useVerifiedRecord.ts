import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnterpriseAdminCreationRecord } from '@ruidong/shared';
import { creationError, enterpriseAdminCreationApi as api } from '../../api/v2/enterpriseAdminCreations';
const terminal=new Set(['SUCCEEDED','FAILED_RETRYABLE','FAILED_MANUAL','VOIDED']);
export const pollDelay=(attempt:number)=>Math.min(30000,2000*2**Math.min(attempt,4));
export function useVerifiedRecord(requestId:string,operatorId:string) {
  const scope=operatorId+'/'+requestId, [version,setVersion]=useState(0),sequence=useRef(0);
  const [state,setState]=useState<{scope:string;record:EnterpriseAdminCreationRecord|null;busy:boolean;error:string|null;observedAt:string|null;paused:boolean}>({scope,record:null,busy:true,error:null,observedAt:null,paused:false});
  const refresh=useCallback(()=>{++sequence.current;setVersion(v=>v+1);},[]);
  useEffect(()=>{
    const generation=++sequence.current,abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,attempts=0,errors=0;
    const current=()=>generation===sequence.current&&!abort.signal.aborted;
    setState(s=>({...s,scope,record:s.scope===scope?s.record:null,busy:true,error:null,paused:false}));
    async function read(){
      if(!current())return;
      setState(s=>({...s,busy:true}));
      try{const record=await api.record(requestId,abort.signal);if(!current())return;errors=0;
        const stopped=terminal.has(record.publicStatus),paused=!stopped&&++attempts>=20;
        setState({scope,record,busy:false,error:null,observedAt:new Date().toISOString(),paused});
        if(!stopped&&!paused)timer=setTimeout(read,pollDelay(attempts-1));
      }catch(error){if(!current())return;const e=creationError(error),stopped=e.status===401||e.status===403||e.status===404,paused=stopped||++errors>=5;
        setState(s=>({...s,busy:false,error:e.message,paused}));if(!paused)timer=setTimeout(read,pollDelay(errors));
      }
    }
    void read();return()=>{++sequence.current;abort.abort();if(timer)clearTimeout(timer);};
  },[scope,requestId,version]);
  return {...(state.scope===scope?state:{scope,record:null,busy:true,error:null,observedAt:null,paused:false}),refresh};
}
