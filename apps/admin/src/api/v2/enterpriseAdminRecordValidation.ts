import { ENTERPRISE_ADMIN_PUBLIC_STATUSES, ENTERPRISE_ADMIN_HISTORY_ACTIONS, EnterpriseAdminError as E, ErrorCode } from '@ruidong/shared';
export const uuid = (v:unknown):v is string => typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const identifier=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=64;
const nullableId=(v:unknown)=>v===null||identifier(v);
const text=(v:unknown)=>typeof v==='string'&&v.length<=512;
const nullableText=(v:unknown)=>v===null||text(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const code=(v:unknown)=>v===null||Object.values(E).includes(v as never)||Object.values(ErrorCode).includes(v as never);
export function decision(v:any):boolean {
  return v&&['NONE','RETRY','QUEUED','PROCESSING','TAKEOVER','REPAIR_MISSING_JOB','SETTLE_ACTIVE','MANUAL','UNKNOWN'].includes(v.kind)&&
    ['NONE','RETRY_ORIGINAL','WAIT_FOR_WORKER','RECOVER_ORIGINAL','USE_EXISTING_MANAGE','CHECK_ORIGINAL_RESOURCES','WAIT_FOR_DEPENDENCY'].includes(v.action)&&text(v.reason)&&text(v.message)&&
    (v.kind!=='RETRY'||v.action==='RETRY_ORIGINAL')&&(!['REPAIR_MISSING_JOB','SETTLE_ACTIVE'].includes(v.kind)||v.action==='RECOVER_ORIGINAL')&&
    (v.kind!=='UNKNOWN'||v.action==='WAIT_FOR_DEPENDENCY');
}
export function record(v:any):boolean {
  return v&&uuid(v.requestId)&&identifier(v.applicationId)&&identifier(v.verificationId)&&v.source==='ADMIN_ASSISTED'&&v.verificationMethod==='ADMIN_OFFLINE'&&v.paymentMode==='ADMIN_WAIVED'&&
    text(v.enterpriseName)&&text(v.uscc)&&identifier(v.ownerUserId)&&/^1[3-9]\d\*{4}\d{4}$/.test(v.ownerPhoneMasked)&&identifier(v.createdByAdminId)&&date(v.createdAt)&&
    ENTERPRISE_ADMIN_PUBLIC_STATUSES.includes(v.publicStatus)&&nullableText(v.provisioningStatus)&&nullableId(v.tenantId)&&nullableId(v.billingAccountId)&&typeof v.canRetry==='boolean'&&code(v.errorCode)&&nullableText(v.errorMessage)&&
    (!v.recovery||decision(v.recovery))&&(!v.canRetry||(v.publicStatus==='FAILED_RETRYABLE'&&v.recovery?.kind==='RETRY'))&&
    (v.publicStatus!=='SUCCEEDED'||(v.provisioningStatus==='ACTIVE'&&identifier(v.tenantId)&&identifier(v.billingAccountId)&&v.errorCode===null&&!v.canRetry));
}
export function recovery(v:any):boolean {
  return v&&uuid(v.requestId)&&identifier(v.verificationId)&&identifier(v.applicationId)&&identifier(v.ownerUserId)&&nullableId(v.currentOwnerUserId)&&nullableId(v.tenantId)&&nullableId(v.billingAccountId)&&date(v.observedAt)&&decision(v.decision);
}
export function history(v:any,limit:number,operationId?:string):boolean {
  return v&&v.scope==='REQUEST_AND_ORIGINAL_KEY'&&Array.isArray(v.items)&&v.items.length<=limit&&typeof v.hasMore==='boolean'&&v.items.every((item:any)=>
    uuid(item.id)&&ENTERPRISE_ADMIN_HISTORY_ACTIONS.includes(item.action)&&date(item.createdAt)&&['ADMIN','SYSTEM','UNKNOWN'].includes(item.operatorType)&&nullableId(item.operatorId)&&
    (item.correlationId===null||uuid(item.correlationId))&&(!operationId||item.correlationId===operationId)&&code(item.errorCode)&&nullableText(item.provisioningStatus)&&nullableText(item.jobStatus)&&
    (item.attempts===null||(Number.isSafeInteger(item.attempts)&&item.attempts>=0)))&&
    (v.hasMore?(v.items.length===limit&&v.nextCursor?.id===v.items.at(-1)?.id&&v.nextCursor?.createdAt===v.items.at(-1)?.createdAt):v.nextCursor===null);
}
