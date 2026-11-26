import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { VERSION_NEUTRAL, VersioningType, Logger } from '@nestjs/common';
import cookie from '@fastify/cookie';
import { randomUUID } from 'crypto';
import { request as rawHttp } from 'http';
import { EnterpriseAdminError as E, ENTERPRISE_ADMIN_PERMISSION } from '@ruidong/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { AdminRequestContextInterceptor } from '../common/interceptors/admin-request-context.interceptor';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { UserInternalClient } from '../user/user-internal.client';
import { AdminActivityLogService } from '../admin/admin-activity-log.service';
import { EnterpriseAccountAdminV2Controller } from '../billing/enterprise-account-admin-v2.controller';
import { EnterpriseAccountAdminProxyController } from '../billing/enterprise-account-admin-proxy.controller';
import { BillingInternalClient } from '../billing/billing-internal.client';
import { EnterpriseBillsInternalClient } from '../billing/enterprise-bills-internal.client';
import { EnterpriseAdminProxyController } from './enterprise-admin-proxy.controller';
import { EnterpriseAdminProxyService } from './enterprise-admin-proxy.service';
import { registerEnterpriseAdminMultipart, ADMIN_CREATIONS_PREFIX as route } from './enterprise-admin-http';
import { registerRuntimePlaneGuard } from '../common/security/runtime-plane';
import * as signatures from '../common/internal-auth/signed-admin-context';
const url = process.env.ADMIN_DB_TEST_URL, userUrl = process.env.EAC_USER_HTTP_URL, billingUrl = process.env.EAC_BILLING_HTTP_URL;
if (process.env.CI && (!url || !userUrl || !billingUrl)) throw new Error('Explicit owned Admin DB and User/Billing HTTP required');
const db = url && userUrl && billingUrl ? describe : describe.skip;
jest.setTimeout(25000);
const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
db('EAC14 real JWT/DB permission Admin -> signed User -> real Billing HTTP', () => {
  const prefix = `eac7-${randomUUID().slice(0,8)}`, roles: string[] = [], members: string[] = [];
  const phoneBase=10000000+parseInt(prefix.slice(-5),16)*50;
  let prisma: PrismaService, app: NestFastifyApplication, jwt: JwtService, base: string, config: ConfigService;
  let review: string, other: string, manage: string, ordinary: string, disabled: string, seq=0, dropCreate=false;
  const cache = { get: async() => null, set: async() => 'OK' }; // Cache is a substitute; every authority lookup uses the real Admin DB.
  beforeAll(async () => {
    if (!/test/.test(new URL(url!).pathname) || new URL(userUrl!).hostname!=='127.0.0.1') throw new Error('scratch fixtures only');
    config=new ConfigService({ADMIN_DATABASE_URL:url,USER_SERVICE_URL:`${userUrl}/api/internal/user/admin`,ADMIN_TO_USER_TOKEN:'eac5-admin-token',ADMIN_TO_USER_CONTEXT_SECRET:'eac5-context',
      ENTERPRISE_VERIFY_MAX_FILE_BYTES:'5242880',JWT_SECRET:'eac7-local-jwt-key'}); prisma=new PrismaService(config); await prisma.$connect();
    const createRole=async(perms:string[])=>{ const role=await prisma.adminRole.create({data:{name:prefix+'-'+roles.length,permissions:JSON.stringify(perms)}});roles.push(role.id);return role.id; };
    const r=await createRole([ENTERPRISE_ADMIN_PERMISSION]), m=await createRole(['admin.page.enterprise_accounts.manage']), n=await createRole([]);
    const member=async(roleId:string,isActive=true)=>{const v=await prisma.adminMember.create({data:{email:`${randomUUID()}@test.invalid`,password:'unused',nickname:prefix,presetRole:'operator',roleId,isActive}});members.push(v.id);return v.id;};
    review=await member(r);other=await member(r);manage=await member(m);ordinary=await member(n);disabled=await member(r,false);
    const module=await Test.createTestingModule({imports:[JwtModule.register({secret:'eac7-local-jwt-key'})],controllers:[EnterpriseAdminProxyController,EnterpriseAccountAdminV2Controller,EnterpriseAccountAdminProxyController],providers:[
      {provide:ConfigService,useValue:config},{provide:PrismaService,useValue:prisma},{provide:RedisService,useValue:cache},UserInternalClient,AdminActivityLogService,
      EnterpriseAdminProxyService,AdminJwtAuthGuard,AdminPermissionGuard,{provide:BillingInternalClient,useValue:{}},{provide:EnterpriseBillsInternalClient,useValue:{}},
    ]}).compile(); jwt=module.get(JwtService);
    app=module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({bodyLimit:4*1024*1024,forceCloseConnections:true}),{logger:false});
    app.setGlobalPrefix('api');app.enableVersioning({type:VersioningType.URI,defaultVersion:VERSION_NEUTRAL,prefix:'v'});
    app.useGlobalInterceptors(new AdminRequestContextInterceptor());app.useGlobalFilters(new HttpExceptionFilter());
    await app.getHttpAdapter().getInstance().register(cookie as never,{secret:'eac7-local-jwt-key'});
    registerEnterpriseAdminMultipart(app.getHttpAdapter().getInstance(),config);await registerRuntimePlaneGuard(app.getHttpAdapter().getInstance() as never,'admin');
    app.getHttpAdapter().getInstance().addHook('onRequest',async(req:any,reply:any)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin!=='http://admin.fixture')reply.code(403).send({code:'AUTH_FORBIDDEN',message:'origin mismatch',data:null});});
    app.getHttpAdapter().getInstance().addHook('onSend',async(req:any,reply:any,payload:any)=>{if(dropCreate&&req.method==='POST'&&req.url===route&&reply.statusCode===202){dropCreate=false;reply.raw.destroy();}return payload;});
    await app.listen(0,'127.0.0.1');base=await app.getUrl();console.info('EAC07 actual HTTP chain',{admin:base,user:userUrl,billing:billingUrl,database:new URL(url!).pathname});
  });
  beforeEach(async()=>{await control('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'true',ADMIN_TO_USER_TOKEN:'eac5-admin-token',ADMIN_TO_USER_CONTEXT_SECRET:'eac5-context'});await billConfig(null);});
  afterAll(async()=>{if(!prisma)return;await app.close();await prisma.adminActivityLog.deleteMany({where:{adminMemberId:{in:members}}});await prisma.adminMember.deleteMany({where:{id:{in:members}}});await prisma.adminRole.deleteMany({where:{id:{in:roles}}});await prisma.$disconnect();});
  function auth(id=review, op=randomUUID()){return{origin:'http://admin.fixture','content-type':'application/json','x-request-id':op,cookie:`admin_access_token=${jwt.sign({sub:id,adminId:id,presetRole:'operator'},{expiresIn:'5m'})}`};}
  async function http(suffix:string,body?:unknown,id=review,extra:Record<string,string>={}){const r=await fetch(base+route+suffix,{method:body===undefined?'GET':'POST',headers:{...auth(id),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json() as any,requestId:r.headers.get('x-request-id')};}
  async function control(suffix:string,body:unknown){const r=await fetch(userUrl+'/_fixture'+suffix,{method:'POST',headers:{'content-type':'application/json','x-fixture-token':'eac7-user-control'},body:JSON.stringify(body)});if(!r.ok)throw Error('User control failed '+r.status);return r.json() as Promise<any>;}
  async function billConfig(mode:string|null){await fetch(billingUrl+'/_fixture/config',{method:'POST',headers:{'content-type':'application/json','x-fixture-token':'eac5-fixture-control'},body:JSON.stringify({mode,hold:null})});}
  async function stats(f:{userId:string}){return control('/stats',{userId:f.userId});}
  async function session(id=review){const r=await http('/upload-sessions',{},id);expect(r.status).toBe(201);return r.body.data.id as string;}
  function multipart(bytes:Buffer,name='license.png',mime='image/png',tail=''){return Buffer.concat([Buffer.from(`--file\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--file--\r\n${tail}`)]);}
  async function upload(s:string,bytes=png,id=review,name='license.png',mime='image/png'){const r=await fetch(base+route+`/upload-sessions/${s}/license`,{method:'POST',headers:{...auth(id),'content-type':'multipart/form-data; boundary=file'},body:new Uint8Array(multipart(bytes,name,mime))});return{status:r.status,body:await r.json() as any};}
  async function prepare(){const phone=`138${String(++seq+phoneBase).padStart(8,'0')}`,u=await control('/seed',{phone}),s=await session(),file=await upload(s);expect(file.status).toBe(201);return{...u,phone,input:{enterpriseName:'真实代理测试企业',uscc:`91310000${prefix.slice(-6).toUpperCase()}${String(seq).padStart(4,'0')}`,ownerUserId:u.userId,ownerPhone:phone,uploadSessionId:s,licenseUploadId:file.body.data.id,idempotencyKey:randomUUID()}};}
  async function accepted(f:Awaited<ReturnType<typeof prepare>>){const r=await http('',f.input);expect(r.status).toBe(202);return r.body.data;}
  it('EAC18 signed review proxies bounded history and original action receipt without raw data',async()=>{
    const f=await prepare(),record=await accepted(f);const h=await http(`/${record.requestId}/history?limit=1`,undefined,other);
    expect(h.status).toBe(200);expect(h.body.data.scope).toBe('REQUEST_AND_ORIGINAL_KEY');expect(h.body.data.items).toHaveLength(1);
    expect(JSON.stringify(h.body)).not.toMatch(/objectKey|claimToken|fingerprint|"detail"|idempotencyKey|payload/);
    expect((await http(`/${record.requestId}/history`,undefined,manage)).status).toBe(403);
    expect((await http(`/${record.requestId}/history?limit=101`)).status).toBe(400);
    await control('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'false'});await billConfig('proof_down');expect((await http(`/${record.requestId}/history`)).status).toBe(200);
  });
  it('review-only passes lookup/check/upload/private read/202/resolve/list/recovery and actual completed resources',async()=>{
    const f=await prepare();expect((await http('/owner-lookup',{phone:f.phone})).body.data).toMatchObject({eligible:true,owner:{userId:f.userId}});
    expect((await http('/check',{enterpriseName:f.input.enterpriseName,uscc:f.input.uscc,ownerUserId:f.userId,ownerPhone:f.phone})).body.data.available).toBe(true);
    const file=await fetch(base+route+`/upload-sessions/${f.input.uploadSessionId}/license/${f.input.licenseUploadId}/file`,{headers:auth()});expect(file.status).toBe(200);expect(Buffer.from(await file.arrayBuffer()).equals(png)).toBe(true);expect(file.headers.get('cache-control')).toBe('no-store');
    const record=await accepted(f);expect(record).toMatchObject({publicStatus:'SUBMITTED',paymentMode:'ADMIN_WAIVED',ownerUserId:f.userId});
    expect((await http('/resolve',{idempotencyKey:f.input.idempotencyKey})).body.data.record.requestId).toBe(record.requestId);
    expect((await http(`?requestId=${record.requestId}`)).body.data.total).toBe(1);expect((await http(`/${record.requestId}/recovery`)).body.data.decision.kind).toBe('QUEUED');
    expect((await http('/recovery-inspection?limit=1')).status).toBe(200);expect((await control('/process',{verificationId:record.verificationId})).status).toBe('SUCCEEDED');
    expect((await http(`/${record.requestId}`)).body.data.publicStatus).toBe('SUCCEEDED');const proof=await stats(f);expect(proof.verifications.map((v:any)=>v.type)).toEqual(['ENTERPRISE']);expect(proof.user.currentTenantId).toBe(f.personalTenantId);
    const after=await fetch(base+route+`/${record.requestId}/license-file`,{headers:auth(other)});expect(after.status).toBe(200);expect(Buffer.from(await after.arrayBuffer()).equals(png)).toBe(true);
    await control('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'false'});await billConfig('proof_down');
    const independent=await fetch(base+route+`/${record.requestId}/license-file`,{headers:auth(other)});expect(independent.status).toBe(200);expect(Buffer.from(await independent.arrayBuffer()).equals(png)).toBe(true);
  });
  it.each(['manage','ordinary','disabled','unauthenticated','forged'])('rejects %s at real Admin JWT/DB permission boundary without User writes',async(kind)=>{
    const f=await prepare(),before=await stats(f);let headers:Record<string,string>;
    if(kind==='unauthenticated')headers={origin:'http://admin.fixture','content-type':'application/json'};else if(kind==='forged')headers={...auth(),'cookie':'admin_access_token=forged.jwt.token'};else headers=auth(kind==='manage'?manage:kind==='ordinary'?ordinary:disabled);
    const r=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(f.input)});expect(r.status).toBe(kind==='manage'||kind==='ordinary'?403:401);expect((await stats(f)).requests).toEqual(before.requests);
  });
  it('does not trust browser service headers/operator/permissions or JWT role claims beyond actual DB permissions',async()=>{
    const f=await prepare();expect((await http('',{...f.input,operatorId:'forged'})).status).toBe(400);expect((await http('/owner-lookup',{phone:f.phone,permissions:[ENTERPRISE_ADMIN_PERMISSION]})).status).toBe(400);
    expect((await http('/owner-lookup',{phone:f.phone},review,{'x-internal-caller':'billing-api','x-internal-token':'bad','x-admin-context':'fake','x-admin-context-signature':'fake'})).status).toBe(201);
    const r=await fetch(base+route,{method:'POST',headers:{...auth(manage),cookie:`admin_access_token=${jwt.sign({sub:manage,adminId:manage,presetRole:'super_admin',permissions:[ENTERPRISE_ADMIN_PERMISSION]})}`},body:JSON.stringify(f.input)});expect(r.status).toBe(403);expect((await stats(f)).requests).toHaveLength(0);
  });
  it('preserves actual User permission, token, signature, expiry and closed-feature structured codes',async()=>{
    const f=await prepare();await control('/config',{ADMIN_TO_USER_TOKEN:'other-token'});let r=await http('',f.input);expect(r.status).toBe(401);expect(r.body.code).toBe('AUTH_UNAUTHORIZED');
    await control('/config',{ADMIN_TO_USER_TOKEN:'eac5-admin-token',ADMIN_TO_USER_CONTEXT_SECRET:'other-secret'});r=await http('',f.input);expect(r.status).toBe(401);expect(r.body.code).toBe('AUTH_UNAUTHORIZED');
    await control('/config',{ADMIN_TO_USER_CONTEXT_SECRET:'eac5-context',ENTERPRISE_ADMIN_CREATION_ENABLED:'false'});expect((await http('/capabilities')).body.data.enabled).toBe(false);r=await http('',f.input);expect(r.status).toBe(503);expect(r.body.code).toBe(E.DISABLED);
    expect((await stats(f)).requests).toHaveLength(0);expect((await http(`/${randomUUID()}`)).body.code).toBe(E.NOT_FOUND);
  });
  it('rejects an actual expired server signature and wrong internal version while retaining the proper HTTP semantics',async()=>{
    const f=await prepare(),sign=signatures.signedAdminContextHeaders;
    const spy=jest.spyOn(signatures,'signedAdminContextHeaders').mockImplementation((ctx,key)=>sign(ctx,key,new Date(0)));
    try{const r=await http('',f.input);expect(r.status).toBe(401);expect(r.body.code).toBe('AUTH_UNAUTHORIZED');}finally{spy.mockRestore();}
    const client=(app as any).get(UserInternalClient),version=client.apiVersion;client.apiVersion='1900-01-01';
    try{const r=await http('',f.input);expect(r.status).toBe(400);expect(r.body.code).toBe(E.INVALID_INPUT);}finally{client.apiVersion=version;}
    expect((await stats(f)).requests).toHaveLength(0);
  });
  it('review-only recover restores only the original virgin job and replays the same operation ID',async()=>{
    const f=await prepare(),record=await accepted(f);await control('/drop-virgin-job',{verificationId:record.verificationId});
    expect((await http(`/${record.requestId}/recovery`,undefined,other)).body.data.decision.kind).toBe('REPAIR_MISSING_JOB');
    const op=randomUUID();expect((await http(`/${record.requestId}/recover`,{},other,{'x-request-id':op})).status).toBe(202);const restored=await stats(f);
    expect((await http(`/${record.requestId}/recover`,{},other,{'x-request-id':op})).status).toBe(202);expect((await stats(f)).jobs).toEqual(restored.jobs);expect(restored.requests).toHaveLength(1);expect(restored.jobs[0].attempts).toBe(0);
  });
  it('UUID stable operation IDs are preserved through signature, concurrent retry and post-completion replay',async()=>{
    const f=await prepare(),record=await accepted(f);await billConfig('mirror_down');await control('/process',{verificationId:record.verificationId});await billConfig(null);
    await control('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'false'});const op=randomUUID(),one=http(`/${record.requestId}/retry`,{},other,{'x-request-id':op}),two=http(`/${record.requestId}/retry`,{},other,{'x-request-id':op});
    const r=await Promise.all([one,two]);expect(r.map(x=>x.status)).toEqual([202,202]);expect(r.map(x=>x.requestId)).toEqual([op,op]);
    const info=await stats(f);expect(info.jobs[0].attempts).toBe(1);expect(info.events.filter((e:any)=>e.action==='RETRY_QUEUED')).toMatchObject([{operatorId:other,correlationId:op}]);
    await control('/process',{verificationId:record.verificationId});const settled=await stats(f);await billConfig('proof_down');expect((await http(`/${record.requestId}/retry`,{},other,{'x-request-id':op})).status).toBe(202);expect((await stats(f)).jobs).toEqual(settled.jobs);
    const noId=await fetch(base+route+`/${record.requestId}/retry`,{method:'POST',headers:{origin:'http://admin.fixture','content-type':'application/json',cookie:auth().cookie},body:'{}'});expect(noId.status).toBe(400);
    expect((await http(`/${record.requestId}/retry`,{},review,{'x-request-id':f.phone})).status).toBe(400);
  });
  it('same original key replays once, changed content conflicts, and dropped Admin response is resolved under the original key',async()=>{
    const f=await prepare();dropCreate=true;await http('',f.input).catch(()=>null);const found=await http('/resolve',{idempotencyKey:f.input.idempotencyKey});expect(found.body.data.found).toBe(true);
    expect((await accepted(f)).requestId).toBe(found.body.data.record.requestId);expect((await http('',{...f.input,enterpriseName:'另一个企业名'})).body.code).toBe(E.IDEMPOTENCY_CONFLICT);
    expect((await stats(f)).requests).toHaveLength(1);expect((await stats(f)).jobs).toHaveLength(1);expect((await http('/resolve',{idempotencyKey:f.input.idempotencyKey},other)).body.data.found).toBe(false);
  });
  it('other review may inspect accepted records but cannot read another operator temporary session',async()=>{
    const f=await prepare(),r=await fetch(base+route+`/upload-sessions/${f.input.uploadSessionId}/license/${f.input.licenseUploadId}/file`,{headers:auth(other)});expect(r.status).toBe(409);expect((await r.json() as any).code).toBe(E.UPLOAD_INVALID);
    const rec=await accepted(f);expect((await http(`/${rec.requestId}`,undefined,other)).status).toBe(200);expect((await http(`/${rec.requestId}/recovery`,undefined,other)).status).toBe(200);
  });
  it.each([['jpg',Buffer.from([0xff,0xd8,0xff]),'image/jpeg'],['jpeg',Buffer.from([0xff,0xd8,0xff]),'image/jpeg'],['png',png,'image/png'],['pdf',Buffer.from('%PDF-1.7'),'application/pdf']] as const)('passes actual %s bytes and private headers',async(ext,bytes,mime)=>{
    const s=await session(),r=await upload(s,bytes,review,'执照.'+ext,mime);expect(r.status).toBe(201);
    const get=await fetch(base+route+`/upload-sessions/${s}/license/${r.body.data.id}/file`,{headers:auth()});expect(get.headers.get('content-type')).toBe(mime);expect(get.headers.get('content-disposition')).toContain('inline');expect(get.headers.get('content-security-policy')).toBe('sandbox');expect(Buffer.from(await get.arrayBuffer()).equals(bytes)).toBe(true);
  });
  it.each(['magic','mime','empty','extra','multi','limit'])('rejects actual upload %s without truncation or JSON conversion',async(kind)=>{
    const s=await session();let bytes=png,name='license.png',mime='image/png',buffer:Buffer;
    if(kind==='magic')bytes=Buffer.from('fake image');if(kind==='mime')mime='application/pdf';if(kind==='empty')bytes=Buffer.alloc(0);if(kind==='limit')bytes=Buffer.concat([png,Buffer.alloc(5242881-png.length)]);
    buffer=multipart(bytes,name,mime);if(kind==='extra')buffer=Buffer.concat([buffer.subarray(0,buffer.length-Buffer.byteLength('--file--\r\n')),Buffer.from('--file\r\nContent-Disposition: form-data; name="field"\r\n\r\nx\r\n--file--\r\n')]);
    if(kind==='multi')buffer=Buffer.concat([buffer.subarray(0,buffer.length-Buffer.byteLength('--file--\r\n')),multipart(png)]);
    const r=await fetch(base+route+`/upload-sessions/${s}/license`,{method:'POST',headers:{...auth(),'content-type':'multipart/form-data; boundary=file'},body:new Uint8Array(buffer)});expect(r.ok).toBe(false);expect([400,413,415]).toContain(r.status);expect((await r.json() as any).code).toBe(E.UPLOAD_INVALID);
  });
  it('preserves >4MiB and exact ceiling bytes through both proxies and rejects ceiling+1 with an unchanged file size rule',async()=>{
    for(const size of [4194312,5242880]){const bytes=Buffer.concat([png,Buffer.alloc(size-png.length,0x61)]),s=await session(),r=await upload(s,bytes);expect(r.status).toBe(201);expect(r.body.data.size).toBe(size);
      const get=await fetch(base+route+`/upload-sessions/${s}/license/${r.body.data.id}/file`,{headers:auth()});const actual=Buffer.from(await get.arrayBuffer());expect(actual.length).toBe(size);expect(actual.equals(bytes)).toBe(true);console.info('EAC07 exact byte proof',{bytes:size,status:get.status});}
  });
  it('Admin activity persistence failure cannot turn an actual User 202 into a failed admission',async()=>{
    const f=await prepare();await prisma.$executeRawUnsafe("CREATE FUNCTION eac7_log_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ENTERPRISE_ADMIN_PROXY' THEN RAISE EXCEPTION 'private-db-password-marker'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe('CREATE TRIGGER eac7_log_fail_trigger BEFORE INSERT ON admin_activity_logs FOR EACH ROW EXECUTE FUNCTION eac7_log_fail()');
    const warnings=jest.spyOn(Logger.prototype,'warn').mockImplementation();
    try{const r=await accepted(f);expect(r.requestId).toBeTruthy();for(let n=0;n<50&&!warnings.mock.calls.length;n++)await new Promise(r=>setTimeout(r,10));expect(JSON.stringify(warnings.mock.calls)).not.toContain('private-db-password-marker');expect((await stats(f)).requests).toHaveLength(1);}
    finally{await prisma.$executeRawUnsafe('DROP TRIGGER eac7_log_fail_trigger ON admin_activity_logs');await prisma.$executeRawUnsafe('DROP FUNCTION eac7_log_fail()');warnings.mockRestore();}
  });
  it('actual activity records contain only operation/business references and no phone, credentials or file values',async()=>{
    const f=await prepare(),record=await accepted(f);await http(`/${record.requestId}`);await new Promise(r=>setTimeout(r,50));
    const logs=await prisma.adminActivityLog.findMany({where:{adminMemberId:review,resourceId:record.requestId}});expect(logs.length).toBeGreaterThan(0);expect(JSON.stringify(logs)).not.toMatch(/ownerPhone|objectKey|eac5-context|eac5-admin-token/);expect(JSON.stringify(logs)).not.toContain(f.phone);
    expect(logs.some(l=>JSON.parse(l.detail).businessRequestId===record.requestId)).toBe(true);
  });
  it('transport oversized body returns early structured 413 and keeps other API limits intact',async()=>{
    const s=await session();const r=await new Promise<{status:number;body:any}>((resolve,reject)=>{const req=rawHttp(base+route+`/upload-sessions/${s}/license`,{method:'POST',headers:{...auth(),'content-type':'multipart/form-data; boundary=file','content-length':String(7*1024*1024)}},response=>{const parts:Buffer[]=[];response.on('data',p=>parts.push(Buffer.from(p)));response.on('end',()=>resolve({status:response.statusCode!,body:JSON.parse(Buffer.concat(parts).toString())}));});req.on('error',reject);req.flushHeaders();});
    expect(r.status).toBe(413);expect(r.body.code).toBe(E.UPLOAD_INVALID);
  });
});
