import { useEffect, useRef, useState } from 'react';
import {
  enterpriseAdminCreationSchema, normalizeMainlandPhone, EnterpriseAdminError as E,
  type EnterpriseAdminCreationInput, type EnterpriseAdminLicenseUpload, type EnterpriseAdminOwnerLookup,
} from '@ruidong/shared';
import { creationError, enterpriseAdminCreationApi as api } from '../../api/v2/enterpriseAdminCreations';
import { secureRandomUuid } from '../../utils/secureRandomUuid';

export interface CreationMarker { state: 'UNKNOWN' | 'ACCEPTED'; idempotencyKey: string; requestId?: string }
export interface Confirmation { revision: number; input: Readonly<EnterpriseAdminCreationInput>; nickname: string; phoneMasked: string; fileName: string }
const ownerErrors = new Set<string>([E.USER_NOT_FOUND,E.USER_INACTIVE,E.PHONE_CHANGED,E.PHONE_AMBIGUOUS,E.OWNER_CONFLICT,E.APPLICATION_CONFLICT]);
const uploadErrors = new Set<string>([E.UPLOAD_INVALID,E.UPLOAD_EXPIRED,E.UPLOAD_USED,E.UPLOAD_UNAVAILABLE]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function markerKey(operatorId: string) { return `admin.enterprise-creation.v1.${operatorId}`; }
function readMarker(key: string): CreationMarker | null {
  const raw = localStorage.getItem(key); if (!raw) return null;
  const v = JSON.parse(raw);
  if (!v || !uuid.test(v.idempotencyKey) || !['UNKNOWN','ACCEPTED'].includes(v.state) || (v.state === 'ACCEPTED' && !uuid.test(v.requestId))) throw Error('invalid marker');
  return { state:v.state, idempotencyKey:v.idempotencyKey, ...(v.requestId ? {requestId:v.requestId} : {}) };
}
export function useCreationFlow(operatorId: string, maxBytes: number | undefined, enabled: boolean) {
  const key = markerKey(operatorId);
  const [enterpriseName,setName] = useState(''), [uscc,setUscc] = useState(''), [phone,setPhone] = useState('');
  const [owner,setOwner] = useState<EnterpriseAdminOwnerLookup | null>(null);
  const [upload,setUpload] = useState<EnterpriseAdminLicenseUpload | null>(null), [fileName,setFileName] = useState('');
  const [lookupBusy,setLookupBusy] = useState(false), [uploadBusy,setUploadBusy] = useState(false), [checking,setChecking] = useState(false), [sending,setSending] = useState(false);
  const [error,setError] = useState(''), [confirmation,setConfirmation] = useState<Confirmation | null>(null);
  const [errorField,setErrorField] = useState<'enterpriseName'|'uscc'|'phone'|'license'|null>(null);
  const [storageBlocked,setStorageBlocked] = useState(false), [marker,setMarker] = useState<CreationMarker | null>(() => { try { return readMarker(key); } catch { return {state:'UNKNOWN',idempotencyKey:'unavailable'}; } });
  const [preview,setPreview] = useState<{url:string;type:string} | null>(null), [previewBusy,setPreviewBusy] = useState(false);
  const [now,setNow] = useState(Date.now());
  const alive=useRef(true), revision=useRef(0), lookupSeq=useRef(0), uploadSeq=useRef(0), previewSeq=useRef(0);
  // Cancellation saves work; independent sequences remain authoritative if a transport ignores abort.
  const lookupAbort=useRef<AbortController | null>(null), uploadAbort=useRef<AbortController | null>(null), previewAbort=useRef<AbortController | null>(null);
  const previewUrl=useRef<string | null>(null), latch=useRef(false), checkLatch=useRef(false);
  const locked=Boolean(marker)||sending||storageBlocked, disabled=locked||!enabled;
  function clearPreview() {
    ++previewSeq.current; previewAbort.current?.abort(); if(previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current=null; setPreview(null);setPreviewBusy(false);
  }
  function invalidate() { ++revision.current;setConfirmation(null);setError('');setErrorField(null); }
  function clearUpload() { ++uploadSeq.current;uploadAbort.current?.abort();setUpload(null);setFileName('');setUploadBusy(false);clearPreview(); }
  useEffect(() => {
    alive.current=true;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    const onStorage=(event:StorageEvent)=>{if(event.key===key){try{const value=readMarker(key);if(value){invalidate();setMarker(value);}}catch{setStorageBlocked(true);}}};
    window.addEventListener('storage',onStorage);
    return()=>{alive.current=false;++lookupSeq.current;++uploadSeq.current;++previewSeq.current;lookupAbort.current?.abort();uploadAbort.current?.abort();previewAbort.current?.abort();if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);window.clearInterval(timer);window.removeEventListener('storage',onStorage);};
  },[key]);
  const expired=Boolean(upload && Date.parse(upload.expiresAt)<=now);
  const canConfirm=!disabled&&!lookupBusy&&!uploadBusy&&!checking&&Boolean(owner?.eligible&&owner.owner&&upload&&!expired);
  function edit(field:'enterpriseName'|'uscc'|'phone',value:string) {
    if(disabled||latch.current)return;invalidate();
    if(field==='enterpriseName')setName(value);else if(field==='uscc')setUscc(value);else {setPhone(value);++lookupSeq.current;lookupAbort.current?.abort();setLookupBusy(false);setOwner(null);}
  }
  async function lookup() {
    if(disabled||latch.current)return; const normalized=normalizeMainlandPhone(phone);invalidate();setOwner(null);
    ++lookupSeq.current;lookupAbort.current?.abort();setLookupBusy(false);
    if(!normalized){setError('手机号格式不正确');setErrorField('phone');return;}
    const seq=lookupSeq.current, abort=new AbortController();lookupAbort.current=abort;setLookupBusy(true);
    try{const value=await api.ownerLookup(normalized,abort.signal);if(alive.current&&seq===lookupSeq.current)setOwner(value);}
    catch(err){if(alive.current&&seq===lookupSeq.current){setError(creationError(err).message);setErrorField('phone');}}
    finally{if(alive.current&&seq===lookupSeq.current)setLookupBusy(false);}
  }
  async function selectFile(file:File|null) {
    if(disabled||latch.current)return;invalidate();clearUpload();if(!file)return;
    const validName=/\.(jpg|jpeg|png|pdf)$/i.test(file.name), validType=['image/jpeg','image/png','application/pdf'].includes(file.type);
    if(!maxBytes||!validName||!validType||file.size===0||file.size>maxBytes){setError('请选择符合格式和大小要求的 JPG、PNG 或 PDF 执照');setErrorField('license');return;}
    const seq=uploadSeq.current, abort=new AbortController();uploadAbort.current=abort;setUploadBusy(true);
    try{
      const session=await api.session(abort.signal);if(!alive.current||seq!==uploadSeq.current)return;
      const value=await api.upload(session.id,file,abort.signal);if(!alive.current||seq!==uploadSeq.current)return;
      if(Date.parse(value.expiresAt)<=Date.now()){setError('执照上传已过期，请重新上传');setErrorField('license');return;}setUpload(value);setFileName(file.name);
    }catch(err){if(alive.current&&seq===uploadSeq.current){setError(creationError(err).message);setErrorField('license');}}
    finally{if(alive.current&&seq===uploadSeq.current)setUploadBusy(false);}
  }
  async function viewFile() {
    if(!upload||expired||previewBusy)return;
    clearPreview();const seq=previewSeq.current, fileSeq=uploadSeq.current, abort=new AbortController();previewAbort.current=abort;setPreviewBusy(true);
    try{const blob=await api.file(upload,abort.signal);if(!alive.current||seq!==previewSeq.current||fileSeq!==uploadSeq.current)return;
      const url=URL.createObjectURL(blob);previewUrl.current=url;setPreview({url,type:blob.type});
    }catch(err){if(alive.current&&seq===previewSeq.current){invalidate();clearUpload();setError(creationError(err).message);setErrorField('license');}}
    finally{if(alive.current&&seq===previewSeq.current)setPreviewBusy(false);}
  }
  function fieldError(err:unknown) {
    const e=creationError(err);invalidate();
    if(e.code&&ownerErrors.has(e.code)){++lookupSeq.current;lookupAbort.current?.abort();setOwner(null);setLookupBusy(false);}
    if(e.code&&uploadErrors.has(e.code))clearUpload();
    if(e.code&&ownerErrors.has(e.code))setErrorField('phone');
    else if(e.code&&uploadErrors.has(e.code))setErrorField('license');
    else if(e.code===E.USCC_CONFLICT)setErrorField('uscc');
    setError(e.message);
  }
  async function confirm() {
    if(!canConfirm||checkLatch.current)return;
    const result=enterpriseAdminCreationSchema.safeParse({enterpriseName,uscc,ownerUserId:owner!.owner!.userId,ownerPhone:phone,uploadSessionId:upload!.sessionId,licenseUploadId:upload!.id,idempotencyKey:secureRandomUuid()});
    if(!result.success){const issue=result.error.issues[0];setError(issue?.message||'请核对必填资料');setErrorField(issue?.path[0]==='enterpriseName'?'enterpriseName':issue?.path[0]==='uscc'?'uscc':'phone');return;}
    checkLatch.current=true;setChecking(true);setError('');const version=revision.current;
    // Advisory check cannot authorize the eventual write. The POST uses this frozen snapshot.
    const snapshot:Confirmation={revision:version,input:Object.freeze({...result.data}),nickname:owner!.owner!.nickname,phoneMasked:owner!.owner!.phoneMasked||'未提供脱敏电话',fileName};
    try{await api.check({enterpriseName:result.data.enterpriseName,uscc:result.data.uscc,ownerUserId:result.data.ownerUserId,ownerPhone:result.data.ownerPhone});
      if(alive.current&&version===revision.current&&Date.parse(upload!.expiresAt)>Date.now())setConfirmation(snapshot);
    }catch(err){if(alive.current&&version===revision.current)fieldError(err);}
    finally{checkLatch.current=false;if(alive.current)setChecking(false);}
  }
  async function submit() {
    if(latch.current||!confirmation||confirmation.revision!==revision.current||disabled)return;
    if(!upload||Date.parse(upload.expiresAt)<=Date.now()){fieldError({});setError('执照上传已过期，请重新上传');setErrorField('license');clearUpload();return;}
    const snapshot=confirmation; latch.current=true;
    clearPreview();
    // Persist UNKNOWN before dispatch, so reload/navigation cannot silently issue a second logical create.
    const pending:CreationMarker={state:'UNKNOWN',idempotencyKey:snapshot.input.idempotencyKey};
    try{const previous=readMarker(key);if(previous){setMarker(previous);setConfirmation(null);latch.current=false;return;}localStorage.setItem(key,JSON.stringify(pending));}
    catch{setStorageBlocked(true);setError('无法保存本次操作标识，请恢复浏览器存储后重新进入');latch.current=false;return;}
    setMarker(pending);setSending(true);setConfirmation(null);
    try{const record=await api.create({...snapshot.input});const accepted:CreationMarker={...pending,state:'ACCEPTED',requestId:record.requestId};
      try{localStorage.setItem(key,JSON.stringify(accepted));}catch{/* The already persisted UNKNOWN marker still blocks duplicate creation after reload. */}
      if(alive.current){setMarker(accepted);setError('');}
    }catch(err){const e=creationError(err);
      if(e.definiteRefusal){try{const original=readMarker(key);if(original?.idempotencyKey===pending.idempotencyKey)localStorage.removeItem(key);}catch{if(alive.current)setStorageBlocked(true);}
        if(alive.current){setMarker(null);fieldError(e);}latch.current=false;
      }else if(alive.current)setError(e.message);
    }finally{if(alive.current)setSending(false);}
  }
  function newCreation() {
    if(marker?.state!=='ACCEPTED'||sending)return;
    try{const current=readMarker(key);if(current?.idempotencyKey!==marker.idempotencyKey){setMarker(current);return;}localStorage.removeItem(key);}
    catch{setStorageBlocked(true);return;}
    latch.current=false;setMarker(null);invalidate();clearUpload();setOwner(null);setName('');setUscc('');setPhone('');
  }
  function acceptResolved(requestId:string) {
    if(!uuid.test(requestId)||!marker||!uuid.test(marker.idempotencyKey))return false;
    try{const current=readMarker(key);if(current?.idempotencyKey!==marker.idempotencyKey)return false;
      const accepted:CreationMarker={state:'ACCEPTED',idempotencyKey:marker.idempotencyKey,requestId};localStorage.setItem(key,JSON.stringify(accepted));setMarker(accepted);return true;
    }catch{setStorageBlocked(true);setError('无法保存原请求 ID，请继续按原键核实');return false;}
  }
  return {enterpriseName,uscc,phone,owner,upload,fileName,expired,lookupBusy,uploadBusy,checking,sending,error,errorField,confirmation,marker,disabled,canConfirm,preview,previewBusy,
    edit,lookup,selectFile,viewFile,clearPreview,confirm,submit,newCreation,acceptResolved,returnToEdit:()=>{if(!locked)invalidate();}};
}
