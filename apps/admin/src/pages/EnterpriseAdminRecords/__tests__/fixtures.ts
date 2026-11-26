import type { EnterpriseAdminCreationRecord, EnterpriseAdminRecoveryReport, EnterpriseAdminHistory } from '@ruidong/shared';
export const requestId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
export function record(status:EnterpriseAdminCreationRecord['publicStatus']='SUBMITTED'):EnterpriseAdminCreationRecord {
  return {requestId,applicationId:'application-a',verificationId:'verification-a',source:'ADMIN_ASSISTED',verificationMethod:'ADMIN_OFFLINE',paymentMode:'ADMIN_WAIVED',
    enterpriseName:'记录企业',uscc:'91310000AAAAAAAAAA',ownerUserId:'owner-a',ownerPhoneMasked:'138****0000',createdByAdminId:'operator-a',createdAt:'2026-10-08T00:00:00.000Z',
    publicStatus:status,provisioningStatus:status==='SUCCEEDED'?'ACTIVE':status==='SUBMITTED'?'PENDING':status,tenantId:status==='SUCCEEDED'?'tenant-a':null,billingAccountId:status==='SUCCEEDED'?'account-a':null,
    canRetry:status==='FAILED_RETRYABLE',errorCode:null,errorMessage:null,
    ...(status==='FAILED_RETRYABLE'?{recovery:{kind:'RETRY',action:'RETRY_ORIGINAL',reason:'retry_safe',message:'可按原记录重试'}}:{}),
  };
}
export function report(kind:EnterpriseAdminRecoveryReport['decision']['kind']='RETRY'):EnterpriseAdminRecoveryReport {
  return {requestId,verificationId:'verification-a',applicationId:'application-a',ownerUserId:'owner-a',currentOwnerUserId:'owner-b',tenantId:null,billingAccountId:null,observedAt:'2026-10-08T00:00:00.000Z',
    decision:{kind,reason:'local_observation',message:kind==='UNKNOWN'?'依赖暂不可核实':'已核实原记录',action:kind==='RETRY'?'RETRY_ORIGINAL':['REPAIR_MISSING_JOB','SETTLE_ACTIVE'].includes(kind)?'RECOVER_ORIGINAL':kind==='UNKNOWN'?'WAIT_FOR_DEPENDENCY':'NONE'}};
}
export const history=():EnterpriseAdminHistory=>({items:[],hasMore:false,nextCursor:null,scope:'REQUEST_AND_ORIGINAL_KEY'});
export const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
