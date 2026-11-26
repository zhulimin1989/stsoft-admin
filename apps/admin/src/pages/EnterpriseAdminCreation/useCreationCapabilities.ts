import { useEffect, useState } from 'react';
import type { EnterpriseAdminCapabilities } from '@ruidong/shared';
import { enterpriseAdminCreationApi } from '../../api/v2/enterpriseAdminCreations';

export function useCreationCapabilities(allowed: boolean) {
  const [capabilities,setCapabilities]=useState<EnterpriseAdminCapabilities | null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    setCapabilities(null);setFailed(false);if(!allowed)return;
    const abort=new AbortController();let active=true;
    enterpriseAdminCreationApi.capabilities(abort.signal).then(value=>{if(active)setCapabilities(value);}).catch(()=>{if(active)setFailed(true);});
    return()=>{active=false;abort.abort();};
  },[allowed]);
  return {capabilities,failed};
}
