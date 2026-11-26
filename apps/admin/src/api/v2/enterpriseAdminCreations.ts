import axios from 'axios';
import {
  EnterpriseAdminError as E, ErrorCode,
  type EnterpriseAdminCapabilities, type EnterpriseAdminOwnerLookup,
  type EnterpriseAdminUploadSession, type EnterpriseAdminLicenseUpload,
  type EnterpriseAdminCreationInput, type EnterpriseAdminCheckInput,
  type EnterpriseAdminCreationRecord, type EnterpriseAdminListInput, type EnterpriseAdminRecoveryReport,
  type EnterpriseAdminHistory, type EnterpriseAdminHistoryInput, enterpriseAdminListSchema, enterpriseAdminHistorySchema,
} from '@ruidong/shared';
import * as validate from './enterpriseAdminRecordValidation';
import { secureRandomUuid } from '../../utils/secureRandomUuid';

const transport = axios.create({ baseURL: '/api/admin/v2/enterprise-accounts/admin-creations', withCredentials: true, timeout: 12000 });
const knownCodes = new Set<string>([...Object.values(E), ...Object.values(ErrorCode)]);
const messages: Record<string, string> = {
  [E.DISABLED]: '当前暂不开放代客创建', [E.INVALID_INPUT]: '资料格式不正确，请重新核对',
  [E.USER_NOT_FOUND]: '该手机号没有已注册账号', [E.USER_INACTIVE]: '账号已停用或注销，请重新选择',
  [E.PHONE_CHANGED]: '手机号已变更，请重新查找账号', [E.PHONE_AMBIGUOUS]: '手机号映射存在歧义，请先人工核实',
  [E.OWNER_CONFLICT]: '该账号已是企业 Owner 或关联活企业主体', [E.APPLICATION_CONFLICT]: '已有在途企业申请，请先处理原申请',
  [E.USCC_CONFLICT]: '该企业可能已存在，请核对库内企业信息',
  [E.UPLOAD_INVALID]: '执照文件不符合要求，请重新选择', [E.UPLOAD_EXPIRED]: '执照上传已过期，请重新上传',
  [E.UPLOAD_USED]: '执照已被使用，请重新上传', [E.UPLOAD_UNAVAILABLE]: '执照暂时不可用，请重新上传',
  [E.IDEMPOTENCY_CONFLICT]: '本次操作键与原提交不一致，请核实原请求',
  AUTH_UNAUTHORIZED: '登录状态失效，请重新登录', AUTH_FORBIDDEN: '当前账号没有企业审核权限',
  [E.NOT_RETRYABLE]: '原记录当前不可重试，请重新核实状态', [E.STATE_CONFLICT]: '原记录状态已变化，请重新核实',
  [E.RESOURCE_INCOMPLETE]: '原企业资源不完整或归属已变化，请核查原记录', [E.NOT_FOUND]: '未找到原代办记录或文件',
};
export class EnterpriseCreationApiError extends Error {
  constructor(readonly code: string | null, readonly status: number | null) {
    super(code && messages[code] || '服务暂时不可用，请稍后再核实');
  }
  // Only explicit, pre-admission business refusals allow editing/new logical attempts.
  get definiteRefusal() {
    return (this.status === 400 || this.status === 409) && this.code !== E.IDEMPOTENCY_CONFLICT &&
      [E.INVALID_INPUT, E.USER_NOT_FOUND, E.USER_INACTIVE, E.PHONE_CHANGED, E.PHONE_AMBIGUOUS,
        E.OWNER_CONFLICT, E.APPLICATION_CONFLICT, E.USCC_CONFLICT, E.UPLOAD_INVALID, E.UPLOAD_EXPIRED, E.UPLOAD_USED].includes(this.code as never);
  }
}
export function creationError(error: unknown): EnterpriseCreationApiError {
  return error instanceof EnterpriseCreationApiError ? error : new EnterpriseCreationApiError(null, null);
}
export function creationReason(code: string | null) { return code && messages[code] || '该账号暂不符合企业 Owner 条件'; }
function fail(): never { throw new EnterpriseCreationApiError(null, null); }
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
async function request<T>(method: 'GET' | 'POST', path: string, data: unknown, signal: AbortSignal | undefined, validate: (v: any) => boolean, status?: number, operationId?: string, params?:Record<string,unknown>): Promise<T> {
  if(operationId!==undefined&&!validateUuid(operationId)) throw new EnterpriseCreationApiError(E.INVALID_INPUT,400);
  try {
    const res = await transport.request({ method, url: path, data, signal, ...(params?{params}:{}),
      headers: { 'X-Request-Id': operationId??secureRandomUuid(), ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }) } });
    if ((status && res.status !== status) || res.data?.code !== 0 || !validate(res.data.data)) fail();
    return res.data.data;
  } catch (error) {
    if (error instanceof EnterpriseCreationApiError) throw error;
    const res = axios.isAxiosError(error) ? error.response : undefined;
    const code = typeof res?.data?.code === 'string' && knownCodes.has(res.data.code) ? res.data.code : null;
    // Never retain Axios config, raw server message, body, phone or file in an Error/log.
    throw new EnterpriseCreationApiError(code, res?.status ?? null);
  }
}
const validateUuid=validate.uuid;
const recordPath=(id:string)=>{if(!validateUuid(id))throw new EnterpriseCreationApiError(E.INVALID_INPUT,400);return '/'+id;};
const queryString=(query:Record<string,unknown>)=>new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])).toString();
export const enterpriseAdminCreationApi = {
  record: (requestId:string,signal?:AbortSignal)=>{if(!validateUuid(requestId))throw new EnterpriseCreationApiError(E.INVALID_INPUT,400);
    return request<EnterpriseAdminCreationRecord>('GET',`/${requestId}`,undefined,signal,v=>validate.record(v)&&v.requestId===requestId,200);},
  resolve: (idempotencyKey:string,signal?:AbortSignal)=>{if(!validateUuid(idempotencyKey))throw new EnterpriseCreationApiError(E.INVALID_INPUT,400);
    return request<{found:boolean;record:EnterpriseAdminCreationRecord|null}>('POST','/resolve',{idempotencyKey},signal,
      v=>v&&((v.found===false&&v.record===null)||(v.found===true&&validate.record(v.record))));},
  list: (input:EnterpriseAdminListInput,signal?:AbortSignal)=>{const query=enterpriseAdminListSchema.parse(input);
    return request<{items:EnterpriseAdminCreationRecord[];total:number;page:number;pageSize:number}>('GET','',undefined,signal,
      v=>v&&v.page===query.page&&v.pageSize===query.pageSize&&Number.isSafeInteger(v.total)&&v.total>=0&&Array.isArray(v.items)&&v.items.length<=query.pageSize&&v.items.length<=v.total&&v.items.every((item:any)=>validate.record(item)&&(!query.status||item.publicStatus===query.status)),200,undefined,query);},
  recovery: (requestId:string,signal?:AbortSignal)=>request<EnterpriseAdminRecoveryReport>('GET',`${recordPath(requestId)}/recovery`,undefined,signal,v=>validate.recovery(v)&&v.requestId===requestId,200),
  history: (requestId:string,input:Partial<EnterpriseAdminHistoryInput>={},signal?:AbortSignal)=>{const query=enterpriseAdminHistorySchema.parse(input);
    return request<EnterpriseAdminHistory>('GET',`${recordPath(requestId)}/history?${queryString(query)}`,undefined,signal,v=>validate.history(v,query.limit,query.operationId),200);},
  retry: (requestId:string,operationId:string)=>request<EnterpriseAdminCreationRecord>('POST',`${recordPath(requestId)}/retry`,{},undefined,v=>validate.record(v)&&v.requestId===requestId,202,operationId),
  recover: (requestId:string,operationId:string)=>request<EnterpriseAdminCreationRecord>('POST',`${recordPath(requestId)}/recover`,{},undefined,v=>validate.record(v)&&v.requestId===requestId,202,operationId),
  async recordFile(requestId:string,maxBytes:number,signal?:AbortSignal):Promise<Blob>{
    try{const res=await transport.get(`${recordPath(requestId)}/license-file`,{signal,responseType:'blob',headers:{'X-Request-Id':secureRandomUuid()}});
      if(!(res.data instanceof Blob)||!['image/jpeg','image/png','application/pdf'].includes(res.data.type)||res.data.size<1||res.data.size>maxBytes)fail();return res.data;
    }catch(error){if(error instanceof EnterpriseCreationApiError)throw error;throw new EnterpriseCreationApiError(E.UPLOAD_UNAVAILABLE,axios.isAxiosError(error)?error.response?.status??null:null);}
  },
  capabilities: (signal?: AbortSignal) => request<EnterpriseAdminCapabilities>('GET', '/capabilities', undefined, signal,
    v => v && typeof v.enabled === 'boolean' && v.supportedPlane === 'domestic' && Number.isSafeInteger(v.licenseMaxBytes) && v.licenseMaxBytes > 0 && Number.isSafeInteger(v.uploadTtlSeconds) && v.uploadTtlSeconds > 0),
  ownerLookup: (phone: string, signal?: AbortSignal) => request<EnterpriseAdminOwnerLookup>('POST', '/owner-lookup', { phone }, signal,
    v => v && typeof v.found === 'boolean' && typeof v.eligible === 'boolean' && (v.reasonCode === null || knownCodes.has(v.reasonCode)) &&
      (v.owner === null || (id(v.owner?.userId) && typeof v.owner.nickname === 'string' && (v.owner.phoneMasked === null || (typeof v.owner.phoneMasked === 'string' && /^1[3-9]\d\*{4}\d{4}$/.test(v.owner.phoneMasked))))) &&
      (!v.eligible || (v.found && v.owner && v.reasonCode === null))),
  check: (data: EnterpriseAdminCheckInput, signal?: AbortSignal) => request<{ available: boolean }>('POST', '/check', data, signal, v => v && v.available === true),
  session: (signal?: AbortSignal) => request<EnterpriseAdminUploadSession>('POST', '/upload-sessions', {}, signal, v => v && id(v.id) && date(v.expiresAt)),
  upload: (sessionId: string, file: File, signal?: AbortSignal) => {
    const data = new FormData(); data.append('file', file);
    return request<EnterpriseAdminLicenseUpload>('POST', `/upload-sessions/${encodeURIComponent(sessionId)}/license`, data, signal,
      v => v && id(v.id) && v.sessionId === sessionId && ['image/jpeg', 'image/png', 'application/pdf'].includes(v.contentType) && v.size === file.size && /^[a-f0-9]{64}$/.test(v.sha256) && date(v.expiresAt));
  },
  async file(upload: EnterpriseAdminLicenseUpload, signal?: AbortSignal): Promise<Blob> {
    try {
      const res = await transport.get(`/upload-sessions/${encodeURIComponent(upload.sessionId)}/license/${encodeURIComponent(upload.id)}/file`,
        { signal, responseType: 'blob', headers: { 'X-Request-Id': secureRandomUuid() } });
      if (!(res.data instanceof Blob) || res.data.size !== upload.size || res.data.type !== upload.contentType) fail();
      return res.data;
    } catch (error) {
      if (error instanceof EnterpriseCreationApiError) throw error;
      // Binary error body is never displayed or retained.
      throw new EnterpriseCreationApiError(E.UPLOAD_UNAVAILABLE, axios.isAxiosError(error) ? error.response?.status ?? null : null);
    }
  },
  create: (data: EnterpriseAdminCreationInput) => request<{ requestId: string }>('POST', '', data, undefined,
    v => v && typeof v.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.requestId) && v.source === 'ADMIN_ASSISTED', 202),
};
