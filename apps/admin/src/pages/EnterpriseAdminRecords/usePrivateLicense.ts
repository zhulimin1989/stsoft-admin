import { useEffect, useRef, useState } from 'react';
import { enterpriseAdminCreationApi as api, creationError } from '../../api/v2/enterpriseAdminCreations';
export function usePrivateLicense(requestId:string,operatorId:string){
  const [preview,setPreview]=useState<{url:string;type:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const seq=useRef(0),url=useRef<string|null>(null),abort=useRef<AbortController|null>(null),alive=useRef(true);
  function close(){++seq.current;abort.current?.abort();if(url.current)URL.revokeObjectURL(url.current);url.current=null;setPreview(null);setBusy(false);}
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;++seq.current;abort.current?.abort();if(url.current)URL.revokeObjectURL(url.current);};},[requestId,operatorId]);
  async function view(){close();setError('');setBusy(true);const current=seq.current,ctrl=new AbortController();abort.current=ctrl;
    try{const caps=await api.capabilities(ctrl.signal);if(!alive.current||current!==seq.current)return;
      const blob=await api.recordFile(requestId,caps.licenseMaxBytes,ctrl.signal);if(!alive.current||current!==seq.current)return;
      url.current=URL.createObjectURL(blob);setPreview({url:url.current,type:blob.type});
    }catch(e){if(alive.current&&current===seq.current)setError(creationError(e).message);}
    finally{if(alive.current&&current===seq.current)setBusy(false);}
  }
  return {preview,busy,error,view,close};
}
