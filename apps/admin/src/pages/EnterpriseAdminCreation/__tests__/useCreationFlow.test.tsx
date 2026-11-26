import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnterpriseAdminError as E } from '@ruidong/shared';
import { enterpriseAdminCreationApi as api, EnterpriseCreationApiError } from '../../../api/v2/enterpriseAdminCreations';
import { markerKey, useCreationFlow } from '../useCreationFlow';
vi.mock('../../../api/v2/enterpriseAdminCreations', async original => {
  const module = await original<typeof import('../../../api/v2/enterpriseAdminCreations')>();
  return {...module,enterpriseAdminCreationApi:{session:vi.fn(),upload:vi.fn(),ownerLookup:vi.fn(),check:vi.fn(),create:vi.fn(),file:vi.fn()}};
});
const owner=(userId='user-a')=>({found:true,eligible:true,reasonCode:null,owner:{userId,nickname:'客户账号',phoneMasked:'138****0000'}});
const file=new File(['license'],'license.png',{type:'image/png'});
const uploaded=(id='file-a')=>({id,sessionId:'session-a',size:file.size,contentType:'image/png',sha256:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function setup(enabled=true,max=1024){return renderHook(()=>useCreationFlow('operator-a',max,enabled));}
type Flow=ReturnType<typeof setup>;
async function fill(h:Flow){
  act(()=>{h.result.current.edit('enterpriseName','  测试企业  ');h.result.current.edit('uscc','91310000AAAAAAAAAA');h.result.current.edit('phone','+86 138-0000-0000');});
  await act(async()=>{await h.result.current.lookup();await h.result.current.selectFile(file);});
}
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();
  vi.mocked(api.session).mockResolvedValue({id:'session-a',expiresAt:new Date(Date.now()+60000).toISOString()});
  vi.mocked(api.upload).mockImplementation(async()=>uploaded());vi.mocked(api.ownerLookup).mockResolvedValue(owner());vi.mocked(api.check).mockResolvedValue({available:true});
  vi.mocked(api.create).mockResolvedValue({requestId:'11111111-1111-4111-8111-111111111111'});
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:owned')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());
describe('creation async state and immutable logical attempts',()=>{
  it('creates and persists one secure idempotency key when randomUUID is unavailable',async()=>{
    let seed=0;vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>{bytes.fill(++seed);return bytes;}});
    const h=setup();await fill(h);await act(async()=>h.result.current.confirm());
    const key=h.result.current.confirmation!.input.idempotencyKey;
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await act(async()=>h.result.current.submit());
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:key}));
    expect(JSON.parse(localStorage.getItem(markerKey('operator-a'))!).idempotencyKey).toBe(key);
  });
  it('starts empty, never creates before explicit confirmation, and accepts unverified normal owner',async()=>{
    const h=setup();expect(h.result.current.enterpriseName).toBe('');expect(h.result.current.canConfirm).toBe(false);await fill(h);
    expect(h.result.current.canConfirm).toBe(true);expect(api.create).not.toHaveBeenCalled();expect(h.result.current.owner?.eligible).toBe(true);
    await act(async()=>{await h.result.current.confirm();});expect(h.result.current.confirmation?.input.enterpriseName).toBe('测试企业');expect(h.result.current.confirmation?.input.ownerPhone).toBe('13800000000');
    act(()=>h.result.current.returnToEdit());expect(h.result.current.confirmation).toBeNull();expect(api.create).not.toHaveBeenCalled();
  });
  it('clears selected user immediately on phone input and ignores old result even when cancellation is ignored',async()=>{
    const slow=deferred<ReturnType<typeof owner>>();vi.mocked(api.ownerLookup).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(owner('user-b'));
    const h=setup();act(()=>h.result.current.edit('phone','13800000000'));let p!:Promise<void>;act(()=>{p=h.result.current.lookup();});
    act(()=>h.result.current.edit('phone','13900000000'));expect(h.result.current.owner).toBeNull();await act(async()=>h.result.current.lookup());
    await act(async()=>{slow.resolve(owner());await p;});expect(h.result.current.owner?.owner?.userId).toBe('user-b');
  });
  it.each([E.USER_NOT_FOUND,E.USER_INACTIVE,E.PHONE_AMBIGUOUS,E.OWNER_CONFLICT,E.APPLICATION_CONFLICT])('ineligible %s never enables submission',async reasonCode=>{
    vi.mocked(api.ownerLookup).mockResolvedValue({found:false,owner:null,eligible:false,reasonCode});const h=setup();await fill(h);expect(h.result.current.canConfirm).toBe(false);await act(async()=>h.result.current.confirm());expect(api.check).not.toHaveBeenCalled();
  });
  it('lookup error removes prior eligibility',async()=>{const h=setup();await fill(h);vi.mocked(api.ownerLookup).mockRejectedValue(new EnterpriseCreationApiError(null,503));await act(async()=>h.result.current.lookup());expect(h.result.current.owner).toBeNull();expect(h.result.current.canConfirm).toBe(false);});
  it('superseded session response cannot upload or restore old file',async()=>{
    const slow=deferred<{id:string;expiresAt:string}>();vi.mocked(api.session).mockReturnValueOnce(slow.promise);const h=setup();let p!:Promise<void>;act(()=>{p=h.result.current.selectFile(file);});
    await act(async()=>h.result.current.selectFile(new File(['new'],'new.png',{type:'image/png'})));await act(async()=>{slow.resolve({id:'old',expiresAt:new Date(Date.now()+60000).toISOString()});await p;});
    expect(api.upload).toHaveBeenCalledTimes(1);expect(h.result.current.fileName).toBe('new.png');
  });
  it('superseded upload response cannot restore removed file',async()=>{const slow=deferred<ReturnType<typeof uploaded>>();vi.mocked(api.upload).mockReturnValueOnce(slow.promise);const h=setup();let p!:Promise<void>;await act(async()=>{p=h.result.current.selectFile(file);await Promise.resolve();});await act(async()=>h.result.current.selectFile(null));await act(async()=>{slow.resolve(uploaded());await p;});expect(h.result.current.upload).toBeNull();expect(h.result.current.uploadBusy).toBe(false);});
  it.each([new File([],'empty.png',{type:'image/png'}),new File(['a'],'bad.exe',{type:'image/png'}),new File(['a'],'bad.png',{type:'text/plain'}),new File(['12345'],'big.pdf',{type:'application/pdf'})])('invalid or over-limit file never creates a session ($name)',async bad=>{const h=setup(true,4);await act(async()=>h.result.current.selectFile(bad));expect(h.result.current.upload).toBeNull();expect(api.session).not.toHaveBeenCalled();});
  it('accepts exactly the configured limit and rejects limit plus one',async()=>{const h=setup(true,file.size);await act(async()=>h.result.current.selectFile(file));expect(h.result.current.upload).not.toBeNull();await act(async()=>h.result.current.selectFile(new File(['license!'],'next.png',{type:'image/png'})));expect(h.result.current.upload).toBeNull();expect(api.session).toHaveBeenCalledTimes(1);});
  it('unknown upload leaves no usable selected file and never creates business records',async()=>{vi.mocked(api.upload).mockRejectedValue(new EnterpriseCreationApiError(null,null));const h=setup();await act(async()=>h.result.current.selectFile(file));expect(h.result.current.upload).toBeNull();expect(api.create).not.toHaveBeenCalled();});
  it('private preview is revoked on replacement, and old preview result cannot display',async()=>{
    const h=setup();await fill(h);vi.mocked(api.file).mockResolvedValue(new Blob(['license'],{type:'image/png'}));await act(async()=>h.result.current.viewFile());expect(h.result.current.preview?.url).toBe('blob:owned');
    await act(async()=>h.result.current.selectFile(null));expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned');
    await act(async()=>h.result.current.selectFile(file));const slow=deferred<Blob>();vi.mocked(api.file).mockReturnValue(slow.promise);let p!:Promise<void>;act(()=>{p=h.result.current.viewFile();});await act(async()=>h.result.current.selectFile(null));await act(async()=>{slow.resolve(new Blob(['license']));await p;});expect(h.result.current.preview).toBeNull();expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it('unavailable private file requires re-upload and invalidates confirmation',async()=>{const h=setup();await fill(h);await act(async()=>h.result.current.confirm());vi.mocked(api.file).mockRejectedValue(new EnterpriseCreationApiError(E.UPLOAD_UNAVAILABLE,409));await act(async()=>h.result.current.viewFile());expect(h.result.current.upload).toBeNull();expect(h.result.current.confirmation).toBeNull();});
  it.each(['a','a'.repeat(129)])('rejects trimmed enterprise name bounds before advisory check',async name=>{const h=setup();await fill(h);act(()=>h.result.current.edit('enterpriseName',name));await act(async()=>h.result.current.confirm());expect(h.result.current.confirmation).toBeNull();expect(api.check).not.toHaveBeenCalled();});
  it.each(['91310000aaaaaaaaaa','91310000AAAAAAAAAI','91310000AAAAAAAAA'])('rejects lower-case/forbidden/short USCC without silently normalizing',async code=>{const h=setup();await fill(h);act(()=>h.result.current.edit('uscc',code));await act(async()=>h.result.current.confirm());expect(api.check).not.toHaveBeenCalled();expect(h.result.current.uscc).toBe(code);});
  it('editing while advisory check runs prevents old confirmation',async()=>{const slow=deferred<{available:boolean}>();vi.mocked(api.check).mockReturnValue(slow.promise);const h=setup();await fill(h);let p!:Promise<void>;act(()=>{p=h.result.current.confirm();});act(()=>h.result.current.edit('enterpriseName','新企业'));await act(async()=>{slow.resolve({available:true});await p;});expect(h.result.current.confirmation).toBeNull();});
  it.each(['enterpriseName','uscc','phone'] as const)('editing %s invalidates confirmed snapshot',async field=>{const h=setup();await fill(h);await act(async()=>h.result.current.confirm());act(()=>h.result.current.edit(field,'changed'));expect(h.result.current.confirmation).toBeNull();expect(api.create).not.toHaveBeenCalled();});
  it('double submit sends one immutable key/content; 202 is only accepted with minimal persistence',async()=>{
    const slow=deferred<{requestId:string}>();vi.mocked(api.create).mockReturnValue(slow.promise);const h=setup();await fill(h);await act(async()=>h.result.current.confirm());const snapshot=h.result.current.confirmation!;
    let p!:Promise<void>;act(()=>{p=h.result.current.submit();void h.result.current.submit();h.result.current.edit('enterpriseName','attempted change');});expect(api.create).toHaveBeenCalledTimes(1);expect(api.create).toHaveBeenCalledWith(snapshot.input);expect(h.result.current.disabled).toBe(true);
    await act(async()=>{slow.resolve({requestId:'11111111-1111-4111-8111-111111111111'});await p;});expect(h.result.current.marker?.state).toBe('ACCEPTED');expect(JSON.parse(localStorage.getItem(markerKey('operator-a'))!)).toEqual({state:'ACCEPTED',idempotencyKey:snapshot.input.idempotencyKey,requestId:'11111111-1111-4111-8111-111111111111'});
  });
  it.each([new EnterpriseCreationApiError(null,null),new EnterpriseCreationApiError(E.AUDIT_UNAVAILABLE,503),new EnterpriseCreationApiError(E.IDEMPOTENCY_CONFLICT,409),new EnterpriseCreationApiError('AUTH_FORBIDDEN',403)])('unknown/conflicting/auth result keeps original key and blocks recreate across remount',async error=>{
    vi.mocked(api.create).mockRejectedValue(error);const h=setup();await fill(h);await act(async()=>h.result.current.confirm());const key=h.result.current.confirmation!.input.idempotencyKey;await act(async()=>h.result.current.submit());expect(h.result.current.marker).toEqual({state:'UNKNOWN',idempotencyKey:key});
    act(()=>{h.result.current.newCreation();h.result.current.edit('phone','13900000000');});expect(h.result.current.phone).toBe('+86 138-0000-0000');h.unmount();const restored=setup(false);expect(restored.result.current.marker?.idempotencyKey).toBe(key);expect(restored.result.current.disabled).toBe(true);expect(api.create).toHaveBeenCalledTimes(1);
  });
  it('definite phone-change refusal clears selection and requires new confirmation/key',async()=>{
    vi.mocked(api.create).mockRejectedValueOnce(new EnterpriseCreationApiError(E.PHONE_CHANGED,409));const h=setup();await fill(h);await act(async()=>h.result.current.confirm());const old=h.result.current.confirmation!.input.idempotencyKey;await act(async()=>h.result.current.submit());expect(h.result.current.marker).toBeNull();expect(h.result.current.owner).toBeNull();expect(localStorage.getItem(markerKey('operator-a'))).toBeNull();
    await act(async()=>h.result.current.lookup());await act(async()=>h.result.current.confirm());expect(h.result.current.confirmation!.input.idempotencyKey).not.toBe(old);
  });
  it('explicit accepted new logical action clears all fields and generates a different key',async()=>{const h=setup();await fill(h);await act(async()=>h.result.current.confirm());const old=h.result.current.confirmation!.input.idempotencyKey;await act(async()=>h.result.current.submit());act(()=>h.result.current.newCreation());expect(h.result.current.phone).toBe('');expect(h.result.current.upload).toBeNull();await fill(h);await act(async()=>h.result.current.confirm());expect(h.result.current.confirmation!.input.idempotencyKey).not.toBe(old);});
  it('response after navigation still saves original accepted marker',async()=>{const slow=deferred<{requestId:string}>();vi.mocked(api.create).mockReturnValue(slow.promise);const h=setup();await fill(h);await act(async()=>h.result.current.confirm());let p!:Promise<void>;act(()=>{p=h.result.current.submit();});h.unmount();slow.resolve({requestId:'11111111-1111-4111-8111-111111111111'});await p;const restored=setup(false);expect(restored.result.current.marker?.state).toBe('ACCEPTED');});
  it('expired upload cannot pass confirmation or send',async()=>{vi.mocked(api.upload).mockResolvedValue({...uploaded(),expiresAt:new Date(Date.now()-1000).toISOString()});const h=setup();await fill(h);expect(h.result.current.upload).toBeNull();await act(async()=>h.result.current.confirm());expect(api.create).not.toHaveBeenCalled();});
  it('closed capability forbids file and lookup mutations',async()=>{const h=setup(false);act(()=>h.result.current.edit('phone','13800000000'));await act(async()=>{await h.result.current.lookup();await h.result.current.selectFile(file);});expect(h.result.current.phone).toBe('');expect(api.session).not.toHaveBeenCalled();expect(api.ownerLookup).not.toHaveBeenCalled();});
  it('cannot send if the browser cannot persist its operation marker',async()=>{
    const h=setup();await fill(h);await act(async()=>h.result.current.confirm());const save=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw Error('storage blocked');});
    try{await act(async()=>h.result.current.submit());expect(api.create).not.toHaveBeenCalled();expect(h.result.current.disabled).toBe(true);expect(h.result.current.error).toContain('无法保存');}finally{save.mockRestore();}
  });
  it('corrupt persisted marker fails closed instead of starting with a new key',()=>{localStorage.setItem(markerKey('operator-a'),'bad json');const h=setup();expect(h.result.current.marker?.state).toBe('UNKNOWN');expect(h.result.current.disabled).toBe(true);expect(api.create).not.toHaveBeenCalled();});
  it('expiry between confirmation and submit removes the file and never posts',async()=>{const h=setup();await fill(h);await act(async()=>h.result.current.confirm());const later=Date.parse(h.result.current.upload!.expiresAt)+1,clock=vi.spyOn(Date,'now').mockReturnValue(later);
    try{await act(async()=>h.result.current.submit());expect(api.create).not.toHaveBeenCalled();expect(h.result.current.upload).toBeNull();expect(h.result.current.errorField).toBe('license');}finally{clock.mockRestore();}
  });
  it('another tab pending marker prevents this confirmed form from creating',async()=>{const h=setup();await fill(h);await act(async()=>h.result.current.confirm());const other={state:'UNKNOWN',idempotencyKey:crypto.randomUUID()};localStorage.setItem(markerKey('operator-a'),JSON.stringify(other));await act(async()=>h.result.current.submit());expect(api.create).not.toHaveBeenCalled();expect(h.result.current.marker).toEqual(other);});
  it('USCC conflict keeps upload but points at the code and requires fresh confirmation',async()=>{const h=setup();await fill(h);await act(async()=>h.result.current.confirm());vi.mocked(api.create).mockRejectedValue(new EnterpriseCreationApiError(E.USCC_CONFLICT,409));await act(async()=>h.result.current.submit());expect(h.result.current.errorField).toBe('uscc');expect(h.result.current.confirmation).toBeNull();expect(h.result.current.upload).not.toBeNull();expect(h.result.current.marker).toBeNull();});
  it('editing and invoking a stale submit callback in the same event cannot send an invalidated snapshot',async()=>{const h=setup();await fill(h);await act(async()=>h.result.current.confirm());await act(async()=>{h.result.current.edit('uscc','91310000BBBBBBBBBB');await h.result.current.submit();});expect(api.create).not.toHaveBeenCalled();expect(h.result.current.marker).toBeNull();});
  it('a pending preview is cancelled by submit and cannot open after acceptance',async()=>{const slow=deferred<Blob>();vi.mocked(api.file).mockReturnValue(slow.promise);const h=setup();await fill(h);await act(async()=>h.result.current.confirm());let p!:Promise<void>;act(()=>{p=h.result.current.viewFile();});await act(async()=>h.result.current.submit());await act(async()=>{slow.resolve(new Blob(['license'],{type:'image/png'}));await p;});expect(h.result.current.marker?.state).toBe('ACCEPTED');expect(h.result.current.preview).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();});
});
