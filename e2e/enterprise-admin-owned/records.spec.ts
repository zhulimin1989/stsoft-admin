import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const root=process.env.EAC_BROWSER_FIXTURE_OUTPUT_ROOT;if(!root)throw Error('owned fixture root required');
const admin=JSON.parse(readFileSync(join(root,'admin-browser-endpoint.json'),'utf8')),user=JSON.parse(readFileSync(join(root,'user-http-endpoint.json'),'utf8')).url,bill=JSON.parse(readFileSync(join(root,'billing-http-endpoint.json'),'utf8')).url;
const base=process.env.ADMIN_BASE_URL!,prefix='/api/admin/v2/enterprise-accounts/admin-creations';
if([base,user,bill,admin.url].some(url=>new URL(url).hostname!=='127.0.0.1'))throw Error('owned localhost only');
async function userControl(path:string,body:unknown){const r=await fetch(user+'/_fixture'+path,{method:'POST',headers:{'content-type':'application/json','x-fixture-token':'eac7-user-control'},body:JSON.stringify(body)});expect(r.ok).toBe(true);return r.json() as Promise<any>;}
async function adminControl(path:string,body:unknown={}){const r=await fetch(admin.url+'/api/admin/_fixture'+path,{method:'POST',headers:{'content-type':'application/json','x-fixture-token':'eac8-admin-control'},body:JSON.stringify(body)});expect(r.ok).toBe(true);return r.json();}
async function billControl(mode:string|null){const r=await fetch(bill+'/_fixture/config',{method:'POST',headers:{'content-type':'application/json','x-fixture-token':'eac5-fixture-control'},body:JSON.stringify({mode,hold:null})});expect(r.ok).toBe(true);}
async function signIn(context:any,role='review'){await context.clearCookies();await context.addCookies([{name:'admin_access_token',value:admin.members[role].token,url:base,httpOnly:true,sameSite:'Lax'}]);}
async function create(request:any){
  const phone='139'+String(10000000+Math.floor(Math.random()*89999999)),seed=await userControl('/seed',{phone});
  const headers={cookie:'admin_access_token='+admin.members.review.token,'X-Request-Id':randomUUID(),origin:base};
  const session=await request.post(base+prefix+'/upload-sessions',{headers,data:{}});expect(session.status()).toBe(201);const sid=(await session.json()).data.id;
  const file=await request.post(base+prefix+`/upload-sessions/${sid}/license`,{headers,multipart:{file:{name:'license.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbLIAAAAASUVORK5CYII=','base64')}}});expect(file.status()).toBe(201);
  const body={enterpriseName:'结果页真实企业',uscc:'91310000'+randomUUID().replace(/-/g,'').slice(0,10).toUpperCase(),ownerUserId:seed.userId,ownerPhone:phone,uploadSessionId:sid,licenseUploadId:(await file.json()).data.id,idempotencyKey:randomUUID()};
  const accepted=await request.post(base+prefix,{headers,data:body});expect(accepted.status()).toBe(202);return{...seed,phone,body,record:(await accepted.json()).data};
}
test.beforeEach(async({context})=>{await userControl('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'true',ADMIN_TO_USER_TOKEN:'eac5-admin-token'});await adminControl('/review-permission',{enabled:true});await billControl(null);await signIn(context);});
test.afterEach(async()=>{await adminControl('/review-permission',{enabled:true});await billControl(null);});
test('real result progresses from accepted to complete; closed creation still allows list/history/license and original personal tenant',async({page,request,context})=>{
  const f=await create(request);await page.goto(`/enterprise-accounts-v2/admin-creations/${f.record.requestId}?acRequestId=${f.record.requestId}&acPage=1&q=old`);
  await expect(page.getByText('已受理',{exact:true})).toBeVisible();await expect(page.getByText('创建成功',{exact:true})).toHaveCount(0);
  expect((await userControl('/process',{verificationId:f.record.verificationId})).status).toBe('SUCCEEDED');await page.getByRole('button',{name:'刷新当前状态'}).click();await expect(page.getByText('创建成功',{exact:true})).toBeVisible();
  const stats=await userControl('/stats',{userId:f.userId});expect(stats.user.currentTenantId).toBe(f.personalTenantId);expect(stats.provisionings[0]).toMatchObject({status:'ACTIVE',tenantId:expect.any(String),billingAccountId:expect.any(String)});
  await userControl('/config',{ENTERPRISE_ADMIN_CREATION_ENABLED:'false'});await signIn(context,'otherReview');await page.reload();await expect(page.getByText('创建成功',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'查看原营业执照'}).click();await expect(page.getByAltText('原营业执照')).toHaveJSProperty('naturalWidth',1);await page.getByRole('button',{name:'关闭预览'}).click();await page.getByRole('button',{name:'刷新历史'}).click();await expect(page.getByText('创建已受理',{exact:true})).toBeVisible();
  await page.screenshot({path:join(root,'result-success-wide.png'),fullPage:true});await page.getByRole('button',{name:'返回代办记录'}).click();await expect(page.getByRole('heading',{name:'代办记录',exact:true})).toBeVisible();await expect(page.getByText('结果页真实企业',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/代客创建企业账户/})).toHaveCount(0);await expect(page).toHaveURL(new RegExp('/admin-creations\\?acRequestId='+f.record.requestId));
  writeFileSync(join(root,'result-completion-evidence.json'),JSON.stringify({requestId:f.record.requestId,verificationId:f.record.verificationId,ownerUserId:f.userId,personalTenantId:f.personalTenantId,currentTenantId:stats.user.currentTenantId,provisioning:stats.provisionings[0],requestCount:stats.requests.length,jobCount:stats.jobs.length},null,2));
});
test('real retry response loss retains original operation UUID; receipt and replay reuse original request/resources',async({page,request})=>{
  const f=await create(request);await billControl('create_down');expect(await userControl('/process',{verificationId:f.record.verificationId})).toMatchObject({status:'PENDING',attempts:1});
  const failed=await userControl('/stats',{userId:f.userId});expect(failed.provisionings[0].status).toBe('FAILED_RETRYABLE');expect(failed.provisionings[0].tenantId).toBeTruthy();expect(failed.provisionings[0].billingAccountId).toBeNull();await billControl(null);
  await page.goto(`/enterprise-accounts-v2/admin-creations/${f.record.requestId}`);await expect(page.getByRole('button',{name:'重试原记录'})).toBeVisible();
  const before=await userControl('/stats',{userId:f.userId});await adminControl('/drop-response',{action:'retry'});
  await page.getByRole('button',{name:'重试原记录'}).click();await expect(page.getByText('结果待确认',{exact:true})).toBeVisible();
  const marker=await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('admin.enterprise-action.'))?.[1]);const operation=JSON.parse(marker!);expect(operation.state).toBe('UNKNOWN');
  await page.reload();await expect(page.getByText(operation.operationId,{exact:true})).toBeVisible();await page.getByRole('button',{name:'重发原动作（保留操作 ID）'}).click();await expect(page.getByText('操作已受理，正在核实当前开通状态',{exact:true})).toBeVisible();
  const after=await userControl('/stats',{userId:f.userId});expect(after.requests).toHaveLength(1);expect(after.jobs).toHaveLength(1);expect(after.jobs[0].id).toBe(before.jobs[0].id);expect(after.jobs[0].attempts).toBe(before.jobs[0].attempts);expect(after.provisionings[0].tenantId).toBe(before.provisionings[0].tenantId);
  expect(after.events.filter((e:any)=>e.action==='RETRY_QUEUED'&&e.correlationId===operation.operationId)).toHaveLength(1);
  expect((await userControl('/process',{verificationId:f.record.verificationId})).status).toBe('SUCCEEDED');await page.getByRole('button',{name:'刷新当前状态'}).click();await expect(page.getByText('创建成功',{exact:true})).toBeVisible();
});
test('missing virgin job recovery response loss resolves via actual audit without second initial job or file consumption',async({page,request})=>{
  const f=await create(request);await userControl('/drop-virgin-job',{verificationId:f.record.verificationId});await page.goto(`/enterprise-accounts-v2/admin-creations/${f.record.requestId}`);await expect(page.getByRole('button',{name:'恢复原初次任务'})).toBeVisible();
  await adminControl('/drop-response',{action:'recover'});await page.getByRole('button',{name:'恢复原初次任务'}).click();await expect(page.getByText('结果待确认',{exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'核对原动作回执'}).click();await expect(page.getByText('原动作已受理，正在核实当前开通状态',{exact:true})).toBeVisible();
  const stats=await userControl('/stats',{userId:f.userId});expect(stats.requests).toHaveLength(1);expect(stats.jobs).toHaveLength(1);expect(stats.jobs[0].attempts).toBe(0);expect(stats.events.filter((e:any)=>e.action==='RECOVERY_JOB_REPAIRED')).toHaveLength(1);expect(stats.events.filter((e:any)=>e.action==='UPLOAD_CONSUMED')).toHaveLength(1);
});
test('a real missing wallet after verified success becomes manual; dependency failure never leaves a current success banner',async({page,request})=>{
  // This drift belongs to an imported legacy aggregate. Full V2 prevents deleting a clean wallet.
  await billControl('legacy_account');
  const f=await create(request);await userControl('/process',{verificationId:f.record.verificationId});await page.goto(`/enterprise-accounts-v2/admin-creations/${f.record.requestId}`);await expect(page.getByText('创建成功',{exact:true})).toBeVisible();
  await billControl('proof_down');await page.getByRole('button',{name:'刷新当前状态'}).click();await expect(page.getByText('当前无法核实开通状态',{exact:true})).toBeVisible();await expect(page.getByText('创建成功',{exact:true})).toHaveCount(0);
  await billControl('wallet_missing');await page.getByRole('button',{name:'刷新当前状态'}).click();await expect(page.getByText('需人工处理',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'重试原记录'})).toHaveCount(0);await expect(page.getByRole('button',{name:'创建另一家企业'})).toHaveCount(0);await page.screenshot({path:join(root,'result-manual.png'),fullPage:true});
});
test('live Admin role revocation denies reads/mutations and direct records route for manage-only',async({page,request,context})=>{
  const f=await create(request);await page.goto(`/enterprise-accounts-v2/admin-creations/${f.record.requestId}`);await expect(page.getByText('已受理',{exact:true})).toBeVisible();await adminControl('/review-permission',{enabled:false});await page.getByRole('button',{name:'刷新当前状态'}).click();await expect(page.getByText('当前无法核实开通状态',{exact:true})).toBeVisible();
  const r=await request.post(base+prefix+`/${f.record.requestId}/retry`,{headers:{cookie:'admin_access_token='+admin.members.review.token,'X-Request-Id':randomUUID()},data:{}});expect(r.status()).toBe(403);
  await signIn(context,'manage');await page.goto('/enterprise-accounts-v2/admin-creations');await expect(page).toHaveURL(/\/403$/);expect((await userControl('/stats',{userId:f.userId})).requests).toHaveLength(1);
});
test('unknown creation survives unresolved lookup across refresh without key replacement; narrow result and list navigation are usable',async({page,request})=>{
  const key=randomUUID();await page.goto('/enterprise-accounts-v2/admin-create');await page.evaluate(({operator,key})=>localStorage.setItem('admin.enterprise-creation.v1.'+operator,JSON.stringify({state:'UNKNOWN',idempotencyKey:key})),{operator:admin.members.review.id,key});await page.reload();await expect(page.getByText(/尚未查到原请求/)).toBeVisible();await expect(page.getByRole('button',{name:'创建另一家企业'})).toHaveCount(0);await page.reload();await expect(page.getByText(key,{exact:true})).toBeVisible();
  const f=await create(request);await page.setViewportSize({width:390,height:1000});await page.goto(`/enterprise-accounts-v2/admin-creations/${f.record.requestId}?acRequestId=${f.record.requestId}&acPage=1&reviewStatus=APPROVED&reviewPage=3`);await expect(page.getByText('已受理',{exact:true})).toBeVisible();await page.getByRole('button',{name:'查看原营业执照'}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'查看原营业执照'})).toBeInViewport();await page.screenshot({path:join(root,'result-narrow-actions.png'),fullPage:true});await page.getByRole('button',{name:'返回代办记录'}).click();await expect(page.getByRole('heading',{name:'代办记录',exact:true})).toBeVisible();await expect(page.getByText('结果页真实企业',{exact:true})).toBeVisible();await expect(page).toHaveURL(/\/admin-creations\?.*reviewPage=3/);await page.getByRole('button',{name:'查询记录'}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'查询记录'})).toBeInViewport();await page.screenshot({path:join(root,'records-narrow.png'),fullPage:true});
});
