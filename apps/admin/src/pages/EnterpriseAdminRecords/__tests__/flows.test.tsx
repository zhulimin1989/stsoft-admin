import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { EnterpriseCreationApiError, enterpriseAdminCreationApi as api } from '../../../api/v2/enterpriseAdminCreations';
import { useVerifiedRecord } from '../useVerifiedRecord';
import { actionMarkerKey, useRecordAction } from '../useRecordAction';
import { usePrivateLicense } from '../usePrivateLicense';
import { record,report,history,requestId,otherId,deferred } from './fixtures';
vi.mock('../../../api/v2/enterpriseAdminCreations',async original=>({...await original<typeof import('../../../api/v2/enterpriseAdminCreations')>(),enterpriseAdminCreationApi:{record:vi.fn(),history:vi.fn(),recovery:vi.fn(),retry:vi.fn(),recover:vi.fn(),capabilities:vi.fn(),recordFile:vi.fn()}}));
beforeEach(()=>{
  vi.useFakeTimers();vi.clearAllMocks();Object.values(api).forEach(fn=>vi.mocked(fn).mockReset());localStorage.clear();
  vi.mocked(api.record).mockResolvedValue(record());vi.mocked(api.recovery).mockResolvedValue(report());vi.mocked(api.history).mockResolvedValue(history());
  vi.mocked(api.retry).mockResolvedValue(record());vi.mocked(api.recover).mockResolvedValue(record());
  vi.mocked(api.capabilities).mockResolvedValue({enabled:false,supportedPlane:'domestic',licenseMaxBytes:1024,uploadTtlSeconds:86400});
  vi.mocked(api.recordFile).mockResolvedValue(new Blob(['license'],{type:'image/png'}));
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:owned')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function flush(){await act(async()=>{await Promise.resolve();});}
describe('verified result polling',()=>{
  it('polls nonterminal with backoff, stops at fully verified terminal, and refresh restarts',async()=>{
    vi.mocked(api.record).mockResolvedValueOnce(record()).mockResolvedValueOnce(record('PROVISIONING')).mockResolvedValue(record('SUCCEEDED'));
    const h=renderHook(()=>useVerifiedRecord(requestId,'operator-a'));await flush();expect(h.result.current.record?.publicStatus).toBe('SUBMITTED');
    await act(async()=>vi.advanceTimersByTimeAsync(1999));expect(api.record).toHaveBeenCalledTimes(1);await act(async()=>vi.advanceTimersByTimeAsync(1));expect(h.result.current.record?.publicStatus).toBe('PROVISIONING');
    await act(async()=>vi.advanceTimersByTimeAsync(4000));expect(h.result.current.record?.publicStatus).toBe('SUCCEEDED');await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(api.record).toHaveBeenCalledTimes(3);
    act(()=>h.result.current.refresh());await flush();expect(api.record).toHaveBeenCalledTimes(4);
  });
  it.each(['SUCCEEDED','FAILED_RETRYABLE','FAILED_MANUAL','VOIDED'] as const)('stops polling at %s',async status=>{vi.mocked(api.record).mockResolvedValue(record(status));const h=renderHook(()=>useVerifiedRecord(requestId,'op'));await flush();await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(api.record).toHaveBeenCalledTimes(1);expect(h.result.current.record?.publicStatus).toBe(status);});
  it('keeps VOIDING queryable and never stops on 202-like acceptance',async()=>{vi.mocked(api.record).mockResolvedValue(record('VOIDING'));renderHook(()=>useVerifiedRecord(requestId,'op'));await flush();await act(async()=>vi.advanceTimersByTimeAsync(2000));expect(api.record).toHaveBeenCalledTimes(2);});
  it('dependency failure hides current certainty while preserving explicitly historical success',async()=>{
    vi.mocked(api.record).mockResolvedValueOnce(record('SUCCEEDED')).mockRejectedValue(new EnterpriseCreationApiError(null,503));const h=renderHook(()=>useVerifiedRecord(requestId,'op'));await flush();act(()=>h.result.current.refresh());await flush();expect(h.result.current.error).toBeTruthy();expect(h.result.current.record?.publicStatus).toBe('SUCCEEDED');expect(h.result.current.busy).toBe(false);
    await act(async()=>vi.advanceTimersByTimeAsync(3999));expect(api.record).toHaveBeenCalledTimes(2);await act(async()=>vi.advanceTimersByTimeAsync(1));expect(api.record).toHaveBeenCalledTimes(3);
  });
  it.each([401,403,404])('halts unavailable authority %s',async status=>{vi.mocked(api.record).mockRejectedValue(new EnterpriseCreationApiError('AUTH_FORBIDDEN',status));const h=renderHook(()=>useVerifiedRecord(requestId,'op'));await flush();await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(api.record).toHaveBeenCalledTimes(1);expect(h.result.current.paused).toBe(true);});
  it('never applies old results after request/operator scope changes or unmount',async()=>{
    const slow=deferred<ReturnType<typeof record>>();vi.mocked(api.record).mockReturnValueOnce(slow.promise).mockResolvedValue({...record(),requestId:otherId});const h=renderHook(({id,op})=>useVerifiedRecord(id,op),{initialProps:{id:requestId,op:'op-a'}});h.rerender({id:otherId,op:'op-b'});await flush();await act(async()=>slow.resolve(record('SUCCEEDED')));expect(h.result.current.record?.requestId).toBe(otherId);const signal=vi.mocked(api.record).mock.calls[0][1];expect(signal?.aborted).toBe(true);h.unmount();await act(async()=>vi.advanceTimersByTimeAsync(60000));expect(api.record).toHaveBeenCalledTimes(2);
  });
  it('bounds automatic error attempts and pauses instead of spinning forever',async()=>{vi.mocked(api.record).mockRejectedValue(new EnterpriseCreationApiError(null,503));const h=renderHook(()=>useVerifiedRecord(requestId,'op'));await flush();await act(async()=>vi.advanceTimersByTimeAsync(180000));expect(api.record).toHaveBeenCalledTimes(5);expect(h.result.current.paused).toBe(true);});
});
describe('stable original action and private file lifecycle',()=>{
  const actionHook=()=>renderHook(()=>useRecordAction(requestId,'operator-a',vi.fn()));
  it('creates secure retry and recover operation UUIDs when randomUUID is unavailable',async()=>{
    let seed=0;vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>{bytes.fill(++seed);return bytes;}});
    const h=actionHook();await act(async()=>h.result.current.execute('retry'));
    const retryId=vi.mocked(api.retry).mock.calls[0][1];
    expect(retryId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.mocked(api.recovery).mockResolvedValue(report('REPAIR_MISSING_JOB'));
    await act(async()=>h.result.current.execute('recover'));
    const recoverId=vi.mocked(api.recover).mock.calls[0][1];
    expect(recoverId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(recoverId).not.toBe(retryId);
  });
  it('double click queues once with an opaque UUID marker and never treats 202 as completion',async()=>{
    const slow=deferred<ReturnType<typeof record>>();vi.mocked(api.retry).mockReturnValue(slow.promise);const h=actionHook();let p!:Promise<void>;await act(async()=>{p=h.result.current.execute('retry');void h.result.current.execute('retry');await Promise.resolve();});expect(api.retry).toHaveBeenCalledTimes(1);
    const marker=JSON.parse(localStorage.getItem(actionMarkerKey('operator-a',requestId))!);expect(Object.keys(marker).sort()).toEqual(['action','operationId','requestId','state']);expect(marker.state).toBe('UNKNOWN');
    await act(async()=>{slow.resolve(record());await p;});expect(h.result.current.marker?.state).toBe('ACCEPTED');expect(h.result.current.message).toContain('操作已受理');
  });
  it('unknown action survives reload and same-action resend keeps the exact operation UUID',async()=>{
    vi.mocked(api.retry).mockRejectedValueOnce(new EnterpriseCreationApiError(null,null));const h=actionHook();await act(async()=>h.result.current.execute('retry'));const id=h.result.current.marker!.operationId;h.unmount();const restored=actionHook();await flush();await act(async()=>restored.result.current.execute('retry'));expect(api.retry).toHaveBeenCalledTimes(1);
    await act(async()=>restored.result.current.execute('retry',true));expect(vi.mocked(api.retry).mock.calls.map(call=>call[1])).toEqual([id,id]);expect(restored.result.current.marker?.state).toBe('ACCEPTED');
  });
  it('accepted or rejected old action can start a new deliberate action with a new UUID',async()=>{const h=actionHook();await act(async()=>h.result.current.execute('retry'));const first=h.result.current.marker!.operationId;await act(async()=>h.result.current.execute('retry'));expect(h.result.current.marker!.operationId).not.toBe(first);});
  it('authoritative original action receipt resolves network uncertainty without a second queue',async()=>{
    vi.mocked(api.retry).mockRejectedValue(new EnterpriseCreationApiError(null,null));const h=actionHook();await act(async()=>h.result.current.execute('retry'));const id=h.result.current.marker!.operationId;
    vi.mocked(api.history).mockResolvedValue({...history(),items:[{id:otherId,action:'RETRY_QUEUED',createdAt:'2026-10-08T00:00:00Z',operatorType:'ADMIN',operatorId:'operator-a',correlationId:id,errorCode:null,provisioningStatus:null,jobStatus:'PENDING',attempts:1}]});await act(async()=>h.result.current.checkReceipt());expect(h.result.current.marker?.state).toBe('ACCEPTED');expect(api.retry).toHaveBeenCalledTimes(1);expect(api.history).toHaveBeenCalledWith(requestId,{limit:100,operationId:id},expect.any(AbortSignal));
  });
  it('no receipt or UNKNOWN dependency leaves original action frozen and never enables a new action',async()=>{vi.mocked(api.retry).mockRejectedValue(new EnterpriseCreationApiError(null,null));const h=actionHook();await act(async()=>h.result.current.execute('retry'));vi.mocked(api.recovery).mockResolvedValue(report('UNKNOWN'));await act(async()=>h.result.current.checkReceipt());await act(async()=>h.result.current.execute('retry',true));expect(h.result.current.marker?.state).toBe('UNKNOWN');expect(api.retry).toHaveBeenCalledTimes(1);});
  it('eligible missing-job recovery uses recover, while manual/unknown does not dispatch',async()=>{const h=actionHook();vi.mocked(api.recovery).mockResolvedValue(report('REPAIR_MISSING_JOB'));await act(async()=>h.result.current.execute('recover'));expect(api.recover).toHaveBeenCalledWith(requestId,expect.any(String));vi.mocked(api.recovery).mockResolvedValue(report('MANUAL'));await act(async()=>h.result.current.execute('retry'));expect(api.retry).not.toHaveBeenCalled();});
  it('broken storage or corrupted marker prevents any mutation',async()=>{localStorage.setItem(actionMarkerKey('operator-a',requestId),'broken');const h=actionHook();await flush();await act(async()=>h.result.current.execute('retry'));expect(h.result.current.storageError).toBe(true);expect(api.retry).not.toHaveBeenCalled();});
  it('storage write failure prevents the outgoing action',async()=>{const h=actionHook();const write=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw Error('blocked');});try{await act(async()=>h.result.current.execute('retry'));expect(api.retry).not.toHaveBeenCalled();expect(h.result.current.storageError).toBe(true);}finally{write.mockRestore();}});
  it('private file reads work with creation disabled and revoke URLs on close/unmount',async()=>{const h=renderHook(()=>usePrivateLicense(requestId,'op'));await act(async()=>h.result.current.view());expect(h.result.current.preview?.url).toBe('blob:owned');act(()=>h.result.current.close());expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned');await act(async()=>h.result.current.view());h.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);});
  it('old or cancelled private response cannot reopen a preview',async()=>{const slow=deferred<Blob>();vi.mocked(api.recordFile).mockReturnValue(slow.promise);const h=renderHook(()=>usePrivateLicense(requestId,'op'));let p!:Promise<void>;await act(async()=>{p=h.result.current.view();await Promise.resolve();});act(()=>h.result.current.close());await act(async()=>{slow.resolve(new Blob(['license'],{type:'image/png'}));await p;});expect(h.result.current.preview).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();});
  it('a late HTTP receipt cannot overwrite a newer opaque action marker from another tab',async()=>{
    const slow=deferred<ReturnType<typeof record>>();vi.mocked(api.retry).mockReturnValue(slow.promise);const h=actionHook();let p!:Promise<void>;await act(async()=>{p=h.result.current.execute('retry');await Promise.resolve();});
    const newer={requestId,action:'retry',operationId:crypto.randomUUID(),state:'UNKNOWN'};localStorage.setItem(actionMarkerKey('operator-a',requestId),JSON.stringify(newer));await act(async()=>{slow.resolve(record());await p;});expect(h.result.current.marker).toEqual(newer);expect(JSON.parse(localStorage.getItem(actionMarkerKey('operator-a',requestId))!)).toEqual(newer);
  });
  it('a new marker created during advisory recovery prevents a second outgoing action',async()=>{
    const slow=deferred<ReturnType<typeof report>>();vi.mocked(api.recovery).mockReturnValue(slow.promise);const h=actionHook();let p!:Promise<void>;act(()=>{p=h.result.current.execute('retry');});const newer={requestId,action:'retry',operationId:crypto.randomUUID(),state:'UNKNOWN'};localStorage.setItem(actionMarkerKey('operator-a',requestId),JSON.stringify(newer));await act(async()=>{slow.resolve(report());await p;});expect(api.retry).not.toHaveBeenCalled();expect(h.result.current.marker).toEqual(newer);
  });
  it('a marker corrupted after mount gets a safe storage warning without any dispatch',async()=>{const h=actionHook();localStorage.setItem(actionMarkerKey('operator-a',requestId),'bad json');await act(async()=>h.result.current.execute('retry'));expect(api.retry).not.toHaveBeenCalled();expect(api.recovery).not.toHaveBeenCalled();expect(h.result.current.storageError).toBe(true);});
});
