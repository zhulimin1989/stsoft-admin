import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { record as validRecord } from '../../apps/admin/src/api/v2/enterpriseAdminRecordValidation';
const root=process.env.EAC_BROWSER_FIXTURE_OUTPUT_ROOT;
if(!root)throw new Error('Explicit owned fixture output required; never use shared business databases');
const host=JSON.parse(readFileSync(join(root,'admin-browser-endpoint.json'),'utf8'));
const userHost=JSON.parse(readFileSync(join(root,'user-http-endpoint.json'),'utf8')).url;
const base=process.env.ADMIN_BASE_URL!;
if(new URL(base).hostname!=='127.0.0.1'||new URL(userHost).hostname!=='127.0.0.1')throw Error('localhost only');
const route='/api/admin/v2/enterprise-accounts/admin-creations';
const randomCode=()=> '91310000'+randomUUID().replace(/-/g,'').slice(0,10).toUpperCase();
const phone=()=> '138'+String(10000000+Math.floor(Math.random()*89999999));
async function control(path:string,body:unknown){const r=await fetch(userHost+'/_fixture'+path,{method:'POST',headers:{'content-type':'application/json','x-fixture-token':'eac7-user-control'},body:JSON.stringify(body)});expect(r.ok).toBe(true);return r.json() as Promise<any>;}
async function signIn(context:any,role='review'){await context.addCookies([{name:'admin_access_token',value:host.members[role].token,url:base,httpOnly:true,sameSite:'Lax'}]);}
async function fill(page:any,bytes=128){
  const number=phone(),seed=await control('/seed',{phone:number});
  await page.goto('/enterprise-accounts-v2/admin-create?tab=review&reviewStatus=APPROVED&reviewPage=3&reviewPageSize=20');
  await expect(page.getByRole('textbox',{name:'企业名称'})).toBeEnabled();
  await page.getByRole('textbox',{name:'企业名称'}).fill('浏览器真实链路企业');await page.getByRole('textbox',{name:'统一社会信用代码'}).fill(randomCode());
  const buffer=Buffer.alloc(bytes,0x41);Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbLIAAAAASUVORK5CYII=','base64').copy(buffer);
  await page.getByLabel('选择营业执照').setInputFiles({name:'license.png',mimeType:'image/png',buffer});await expect(page.getByText('已上传',{exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'客户提供的手机号'}).fill(number);await page.getByRole('button',{name:'精确查找账号'}).click();await expect(page.getByText('该账号可作为企业 Owner',{exact:true})).toBeVisible();return{number,seed,buffer};
}
test.beforeEach(async({context})=>{await control('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'true',ADMIN_TO_USER_TOKEN:'eac5-admin-token'});await signIn(context);});
test('real review browser uploads >4MiB privately; confirmation double click gets 202 accepted and one durable request',async({page})=>{
  const f=await fill(page,4194312);const privateRead=page.waitForResponse(r=>r.url().includes('/license/')&&r.url().endsWith('/file'));
  await page.getByRole('button',{name:'私有预览'}).click();const response=await privateRead;expect((await response.body()).equals(f.buffer)).toBe(true);
  const preview=page.getByRole('dialog',{name:'营业执照私有预览'});await expect(preview.getByAltText('营业执照')).toBeVisible();await expect(preview.getByAltText('营业执照')).toHaveJSProperty('naturalWidth',1);
  await preview.getByRole('button',{name:'关闭预览'}).click();await page.screenshot({path:join(root,'browser-form-wide.png'),fullPage:true});
  await page.getByRole('button',{name:'核对提交资料'}).click();const dialog=page.getByRole('dialog',{name:'提交前核对'});await expect(dialog.getByText('浏览器真实链路企业',{exact:true})).toBeVisible();
  let posted:any;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname===route)posted=r.postDataJSON();});
  const accepted=page.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()==='POST');await dialog.getByRole('button',{name:'确认并提交'}).dblclick();expect((await accepted).status()).toBe(202);
  await expect(page.getByText('已受理',{exact:true})).toBeVisible();await expect(page.getByText('创建成功',{exact:true})).toHaveCount(0);
  const stats=await control('/stats',{userId:f.seed.userId});expect(stats.requests).toHaveLength(1);expect(stats.jobs).toHaveLength(1);expect(stats.user.currentTenantId).toBe(f.seed.personalTenantId);expect(stats.requests[0].idempotencyKey).toBe(posted.idempotencyKey);expect(stats.events.filter((e:any)=>e.action==='ACCEPTED')).toHaveLength(1);
  const saved=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('admin.enterprise-creation.')));expect(saved).toHaveLength(1);expect(Object.keys(JSON.parse(saved[0][1])).sort()).toEqual(['idempotencyKey','requestId','state']);expect(saved[0][1]).not.toContain(f.number);
  expect((await control('/process',{verificationId:stats.requests[0].verificationId})).status).toBe('SUCCEEDED');
  const completed=await control('/stats',{userId:f.seed.userId});expect(completed.provisionings[0].status).toBe('ACTIVE');expect(completed.provisionings[0].tenantId).toBeTruthy();expect(completed.provisionings[0].billingAccountId).toBeTruthy();expect(completed.user.currentTenantId).toBe(f.seed.personalTenantId);
  writeFileSync(join(root,'browser-real-completion.json'),JSON.stringify({requestId:stats.requests[0].id,verificationId:stats.requests[0].verificationId,ownerUserId:f.seed.userId,
    requestCount:stats.requests.length,jobCount:stats.jobs.length,acceptedAuditCount:stats.events.filter((e:any)=>e.action==='ACCEPTED').length,
    privateFileBytes:f.buffer.length,privateFileBytesEqual:true,provisioning:completed.provisionings[0],originalPersonalTenantId:f.seed.personalTenantId,currentTenantId:completed.user.currentTenantId},null,2));
  await page.reload();await expect(page.getByText('已受理',{exact:true})).toBeVisible();await page.screenshot({path:join(root,'browser-accepted-wide.png'),fullPage:true});
});
test('live account disable after confirmation is a definite 409 refusal, requiring a new owner lookup',async({page})=>{
  const f=await fill(page);await page.getByRole('button',{name:'核对提交资料'}).click();await expect(page.getByRole('dialog',{name:'提交前核对'})).toBeVisible();await control('/state',{userId:f.seed.userId,isActive:false});
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()==='POST');await page.getByRole('button',{name:'确认并提交'}).click();expect((await response).status()).toBe(409);
  await expect(page.getByText('账号已停用或注销，请重新选择',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'核对提交资料'})).toBeDisabled();expect((await control('/stats',{userId:f.seed.userId})).requests).toHaveLength(0);
});
test('real committed response loss freezes the original key through reload and creates no second request',async({page})=>{
  const f=await fill(page);await page.getByRole('button',{name:'核对提交资料'}).click();const drop=await fetch(host.url+'/api/admin/_fixture/drop-response',{method:'POST',headers:{'x-fixture-token':'eac8-admin-control'}});expect(drop.ok).toBe(true);
  await page.getByRole('button',{name:'确认并提交'}).click();await expect(page).toHaveURL(/\/admin-creations\/[0-9a-f-]{36}/);
  const marker=await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('admin.enterprise-creation.'))?.[1]);expect(JSON.parse(marker!).state).toBe('ACCEPTED');const stats=await control('/stats',{userId:f.seed.userId});expect(stats.requests).toHaveLength(1);expect(stats.requests[0].idempotencyKey).toBe(JSON.parse(marker!).idempotencyKey);expect(JSON.parse(marker!).requestId).toBe(stats.requests[0].id);
  const read=page.waitForResponse(r=>new URL(r.url()).pathname===route+'/'+stats.requests[0].id&&r.request().method()==='GET');
  await page.reload();const response=await read,payload=await response.json();writeFileSync(join(root,'creation-resolve-read-evidence.json'),JSON.stringify({status:response.status(),code:payload.code,publicStatus:payload.data?.publicStatus,recovery:payload.data?.recovery,validShape:validRecord(payload.data)},null,2));expect(response.status()).toBe(200);expect(validRecord(payload.data)).toBe(true);
  await expect(page.getByText('已受理',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'创建另一家企业'})).toHaveCount(0);await expect(page.getByRole('textbox',{name:'企业名称'})).toHaveCount(0);expect((await control('/stats',{userId:f.seed.userId})).requests).toHaveLength(1);
  await page.screenshot({path:join(root,'browser-unknown.png'),fullPage:true});
});
test('manage-only direct route and actual new API are denied',async({page,context,request})=>{
  await context.clearCookies();await signIn(context,'manage');await page.goto('/enterprise-accounts-v2/admin-create');await expect(page).toHaveURL(/\/403$/);await expect(page.getByRole('link',{name:'代客创建企业账户'})).toHaveCount(0);
  const r=await request.get(base+route+'/capabilities',{headers:{cookie:'admin_access_token='+host.members.manage.token}});expect(r.status()).toBe(403);
});
test('closed/faulted capabilities fail closed; no frontend service tokens',async({page})=>{
  await control('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'false'});await page.goto('/enterprise-accounts-v2/admin-create');await expect(page.getByText('当前暂不开放代客创建',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'企业名称'})).toBeDisabled();
  await control('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'true',ADMIN_TO_USER_TOKEN:'wrong-local-token'});await page.reload();await expect(page.getByText('创建能力暂时无法确认，请稍后重新进入',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'企业名称'})).toBeDisabled();
});
test('narrow browser form and returning to list retain navigation without business writes',async({page})=>{
  await page.setViewportSize({width:390,height:1000});const f=await fill(page);await page.screenshot({path:join(root,'browser-form-narrow.png'),fullPage:true});
  const input=await page.getByRole('textbox',{name:'企业名称'}).boundingBox();expect(input!.width).toBeGreaterThan(100);expect(input!.x+input!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'核对提交资料'}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'核对提交资料'})).toBeInViewport();await page.screenshot({path:join(root,'browser-form-narrow-actions.png'),fullPage:true});
  await page.getByRole('button',{name:'核对提交资料'}).click();await page.getByRole('button',{name:'返回修改'}).click();await page.getByRole('button',{name:/取\s*消/}).click();await expect(page).toHaveURL(/\/enterprise-accounts-v2\?tab=review&reviewStatus=APPROVED&reviewPage=3&reviewPageSize=20$/);expect((await control('/stats',{userId:f.seed.userId})).requests).toHaveLength(0);
});
