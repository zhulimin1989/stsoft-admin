import { ConfigService } from '@nestjs/config';
import { UserInternalClient } from '../user/user-internal.client';
import { runWithAdminRequestContext, clearAdminRequestContext } from '../common/request/admin-context';
import { createLoggerConfig } from '../common/logger/logger.config';
import { buildSentryOptions } from '../instrument';
import { EnterpriseAdminError as E } from '@ruidong/shared';
import { createServer, Server } from 'http';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';

// Real HTTP fault responder for dependency envelopes/bytes, not a deployed User business service.
describe('EAC14 dedicated transport safe errors, bounded bytes and telemetry',()=>{
  let server:Server,base:string,client:UserInternalClient,mode='ok',cancelled=false; const seen:any[]=[];
  const context={adminId:randomUUID(),permissions:['admin.page.enterprise_accounts.review'],requestId:randomUUID()};
  beforeAll(async()=>{server=createServer((req,res)=>{seen.push({url:req.url,headers:req.headers});
    if(mode==='hang'){req.on('close',()=>{cancelled=true;});return;}
    if(mode==='error'){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({code:E.USCC_CONFLICT,message:'SDK-private-token-13800138000',data:{objectKey:'private-key',stack:'private-stack'}}));return;}
    if(mode==='html'){res.writeHead(502,{'content-type':'text/html'});res.end('private-token-13800138000');return;}
    if(mode==='unknown'){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({code:'private-sdk-code',message:'private-token'}));return;}
    if(mode==='malformed'){res.writeHead(200,{'content-type':'application/json'});res.end('{');return;}
    if(mode==='fake_success'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:1,message:'private-token',data:{}}));return;}
    if(mode==='file_html'){res.writeHead(200,{'content-type':'text/html','set-cookie':'private-cookie'});res.end('<html>private-token</html>');return;}
    if(mode==='file_limit'){res.writeHead(200,{'content-type':'image/png'});res.end(Buffer.alloc(100));return;}
    if(mode==='file_short'){res.writeHead(200,{'content-type':'image/png','content-length':'100'});res.end(Buffer.from('short'));return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:0,message:'ok',data:{found:true}}));
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as any).port}/api/internal/user/admin`;
  client=new UserInternalClient(new ConfigService({USER_SERVICE_URL:base,ADMIN_TO_USER_TOKEN:'private-test-token',ADMIN_TO_USER_CONTEXT_SECRET:'private-sign-key',INTERNAL_SERVICE_TIMEOUT_MS:'200'}));});
  beforeEach(()=>{mode='ok';cancelled=false;seen.length=0;});afterEach(()=>clearAdminRequestContext());
  afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const call=()=>runWithAdminRequestContext(context,()=>client.enterpriseAdminRequest('POST','/check',undefined,{uscc:'91110000AAAAAAAAAA'}));
  it('sends server credentials and one stable signed UUID without browser-provided authority',async()=>{await expect(call()).resolves.toEqual({found:true});const h=seen[0].headers;
    expect(h['x-internal-caller']).toBe('admin-api');expect(h['x-request-id']).toBe(context.requestId);expect(h['x-admin-context-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(Buffer.from(h['x-admin-context'],'base64url').toString())).toMatchObject(context);expect(seen[0].url).not.toContain('uscc');});
  it('preserves known error code/status with controlled message and no raw body',async()=>{mode='error';await expect(call()).rejects.toMatchObject({status:409,response:{code:E.USCC_CONFLICT,data:null}});
    try{await call();}catch(error){expect(JSON.stringify((error as any).getResponse())).not.toMatch(/private|13800138000|objectKey|stack/);}});
  it.each(['html','unknown','malformed','fake_success'])('refuses %s without exposing dependency contents or declaring a business result',async m=>{mode=m;await expect(call()).rejects.toMatchObject({status:503,response:{code:E.BILLING_UNAVAILABLE,data:null}});});
  it('times out and terminates the real request without returning false success',async()=>{mode='hang';await expect(call()).rejects.toMatchObject({status:503,response:{code:E.BILLING_UNAVAILABLE}});for(let i=0;i<20&&!cancelled;i++)await new Promise(r=>setTimeout(r,10));expect(cancelled).toBe(true);});
  it.each(['file_html','file_limit','file_short'])('refuses unsafe/incomplete binary %s',async m=>{mode=m;await expect(runWithAdminRequestContext(context,()=>client.enterpriseAdminFile('/file',16))).rejects.toMatchObject({status:503});});
  it('cancels an outstanding file request when the caller aborts',async()=>{mode='hang';const abort=new AbortController();const pending=runWithAdminRequestContext(context,()=>client.enterpriseAdminFile('/file',100,undefined,abort.signal));setTimeout(()=>abort.abort(),25);
    await expect(pending).rejects.toMatchObject({status:503});for(let i=0;i<20&&!cancelled;i++)await new Promise(r=>setTimeout(r,10));expect(cancelled).toBe(true);});
  it('Pino drops query/path/invalid operation IDs and redacts bodies and internal credentials',()=>{const options=createLoggerConfig().pinoHttp as any,prefix='/api/admin/v2/enterprise-accounts/admin-creations';
    expect(options.genReqId({url:prefix,headers:{'x-request-id':'13800138000'}})).toMatch(/^[0-9a-f-]{36}$/);
    expect(options.serializers.req({method:'GET',url:prefix+'/13800138000/recovery?phone=13900139000'}).url).not.toMatch(/13800138000|13900139000/);
    let output='';const logger=new PinoLogger({pinoHttp:[{redact:options.redact},{write:(chunk:string)=>{output+=chunk;}}]});
    logger.info({req:{headers:{'x-internal-token':'private-token','x-admin-context':'private-context','x-admin-context-signature':'private-signature'},body:{ownerPhone:'13800138000',phone:'13900139000'}}});expect(output).not.toMatch(/private-token|private-context|private-signature|13800138000|13900139000/);});
  it('Sentry retains tracing while removing private errors, spans, headers, body and locals',()=>{const options=buildSentryOptions({SENTRY_DSN:'https://fixture@fixture.invalid/1'})!;
    const event={request:{url:'http://fixture/api/admin/v2/enterprise-accounts/admin-creations/check?phone=13800138000',method:'POST',data:'private-file',headers:{authorization:'private-token'}},user:{email:'private-user'},extra:{body:'private-data'},breadcrumbs:[{data:{objectKey:'private-key'}}],contexts:{trace:{trace_id:'a'.repeat(32)}},exception:{values:[{value:'private-sdk-error',stacktrace:{frames:[{vars:{secret:'private-secret'}}]}}]}};
    const result=(options.beforeSend as Function)(event,{});expect(JSON.stringify(result)).not.toMatch(/private-|13800138000/);expect(result.contexts.trace.trace_id).toBe('a'.repeat(32));
    const tx=(options.beforeSendTransaction as Function)({...event,spans:[{data:{body:'private-span'}}]},{});expect(JSON.stringify(tx)).not.toContain('private-span');});
});
