// Test-only localhost host. Requires an explicit owned scratch DB and real User HTTP.
// Production guards, signature/proxy, transactions and object storage remain enabled.
const fs=require('fs'),path=require('path'),{createRequire}=require('module'),{randomUUID}=require('crypto');
const apiRoot=path.resolve(__dirname,'../../apps/api'),r=createRequire(path.join(apiRoot,'package.json'));
r('ts-node').register({project:path.join(apiRoot,'tsconfig.json'),transpileOnly:true});r('reflect-metadata');
const src=p=>r(path.join(apiRoot,'src',p));
const {Test}=r('@nestjs/testing'),{ConfigService}=r('@nestjs/config'),{JwtModule,JwtService}=r('@nestjs/jwt');
const {FastifyAdapter}=r('@nestjs/platform-fastify'),{VERSION_NEUTRAL,VersioningType}=r('@nestjs/common');
const {PrismaService}=src('prisma/prisma.service.ts'),{RedisService}=src('redis/redis.service.ts');
const {AdminJwtAuthGuard}=src('common/guards/admin-jwt-auth.guard.ts'),{AdminPermissionGuard}=src('common/guards/admin-permission.guard.ts');
const {AdminRequestContextInterceptor}=src('common/interceptors/admin-request-context.interceptor.ts'),{HttpExceptionFilter}=src('common/filters/http-exception.filter.ts');
const {UserInternalClient}=src('user/user-internal.client.ts'),{AdminActivityLogService}=src('admin/admin-activity-log.service.ts');
const {EnterpriseAdminProxyController}=src('enterprise-admin/enterprise-admin-proxy.controller.ts'),{EnterpriseAdminProxyService}=src('enterprise-admin/enterprise-admin-proxy.service.ts');
const {registerEnterpriseAdminMultipart,ADMIN_CREATIONS_PREFIX}=src('enterprise-admin/enterprise-admin-http.ts');
const {registerRuntimePlaneGuard}=src('common/security/runtime-plane.ts');
const {EnterpriseAccountAdminProxyController}=src('billing/enterprise-account-admin-proxy.controller.ts'),{BillingInternalClient}=src('billing/billing-internal.client.ts');
async function main(){
 const root=process.env.EAC_BROWSER_FIXTURE_OUTPUT_ROOT,url=process.env.ADMIN_DB_TEST_URL,user=process.env.EAC_USER_HTTP_URL;
 if(!root||!url||new URL(url).pathname!=='/eac_admin_test'||new URL(url).hostname!=='127.0.0.1'||!user||new URL(user).hostname!=='127.0.0.1')throw Error('owned localhost scratch required');
 const legacy=process.env.EAC_LEGACY_HTTP_ENABLED==='true',billingUrl=process.env.EAC_BILLING_HTTP_URL;if(legacy&&(!billingUrl||new URL(billingUrl).hostname!=='127.0.0.1'))throw Error('owned Billing HTTP required');
 const jwtKey='eac8-local-test-issuer',config=new ConfigService({ADMIN_DATABASE_URL:url,USER_SERVICE_URL:user+'/api/internal/user/admin',ADMIN_TO_USER_TOKEN:'eac5-admin-token',ADMIN_TO_USER_CONTEXT_SECRET:'eac5-context',ENTERPRISE_VERIFY_MAX_FILE_BYTES:'5242880',JWT_SECRET:jwtKey,...(legacy?{BILLING_SERVICE_URL:billingUrl+'/api/internal/billing/admin',ADMIN_TO_BILLING_TOKEN:'eac11-admin-billing-token',ADMIN_TO_BILLING_CONTEXT_SECRET:'eac11-admin-billing-context'}:{})});
 const prisma=new PrismaService(config);await prisma.$connect();
 const module=await Test.createTestingModule({imports:[JwtModule.register({secret:jwtKey})],controllers:[EnterpriseAdminProxyController,...(legacy?[EnterpriseAccountAdminProxyController]:[])],providers:[
  {provide:ConfigService,useValue:config},{provide:PrismaService,useValue:prisma},{provide:RedisService,useValue:{get:async()=>null,set:async()=>'OK'}},
  UserInternalClient,AdminActivityLogService,EnterpriseAdminProxyService,AdminJwtAuthGuard,AdminPermissionGuard,...(legacy?[BillingInternalClient]:[]),
 ]}).compile();
 const jwt=module.get(JwtService),members={};
 for(const [name,permissions] of Object.entries({review:['admin.page.enterprise_accounts.review'],otherReview:['admin.page.enterprise_accounts.review'],manage:['admin.page.enterprise_accounts.manage'],ordinary:[]})){
  const role=await prisma.adminRole.create({data:{name:'eac8-'+name+'-'+randomUUID(),permissions:JSON.stringify(permissions)}});
  const m=await prisma.adminMember.create({data:{email:randomUUID()+'@test.invalid',password:'unused',nickname:'测试运营 '+name,presetRole:'operator',roleId:role.id}});
  members[name]={id:m.id,token:jwt.sign({sub:m.id,adminId:m.id,presetRole:'operator'},{expiresIn:'2h'})};
 }
 const app=module.createNestApplication(new FastifyAdapter({bodyLimit:4*1024*1024,forceCloseConnections:true}),{logger:false});
 app.setGlobalPrefix('api');app.enableVersioning({type:VersioningType.URI,defaultVersion:VERSION_NEUTRAL,prefix:'v'});app.useGlobalInterceptors(new AdminRequestContextInterceptor());app.useGlobalFilters(new HttpExceptionFilter());
 const fastify=app.getHttpAdapter().getInstance();await fastify.register(r('@fastify/cookie'),{secret:jwtKey});registerEnterpriseAdminMultipart(fastify,config);await registerRuntimePlaneGuard(fastify,'admin');
 let drop=null;
 fastify.addHook('onRequest',async(req,reply)=>{if(req.url.startsWith('/api/admin/_fixture/')&&req.headers['x-fixture-token']!=='eac8-admin-control')reply.code(403).send({code:'AUTH_FORBIDDEN'});
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.url.startsWith('/api/')&&req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin))reply.code(403).send({code:'AUTH_FORBIDDEN'});});
 fastify.addHook('onSend',async(req,reply,payload)=>{const matches=drop==='create'?req.url===ADMIN_CREATIONS_PREFIX:drop&&req.url.startsWith(ADMIN_CREATIONS_PREFIX+'/')&&req.url.endsWith('/'+drop);
  if(matches&&req.method==='POST'&&reply.statusCode===202){drop=null;reply.raw.destroy();}return payload;});
 fastify.post('/api/admin/_fixture/drop-response',async(req,reply)=>{const action=req.body?.action||'create';if(!['create','retry','recover'].includes(action))return reply.code(400).send({error:'bad_action'});drop=action;return{ok:true};});
 fastify.post('/api/admin/_fixture/review-permission',async(req,reply)=>{if(typeof req.body?.enabled!=='boolean')return reply.code(400).send({error:'bad_state'});
  const member=await prisma.adminMember.findUniqueOrThrow({where:{id:members.review.id}});await prisma.adminRole.update({where:{id:member.roleId},data:{permissions:JSON.stringify(req.body.enabled?['admin.page.enterprise_accounts.review']:[])}});return{ok:true};});
 // Local issuer/profile replaces IdP only. It verifies JWT and live Admin DB, using the actual permission resolver.
 fastify.get('/api/admin/auth/profile',async(req,reply)=>{try{const payload=jwt.verify(req.cookies.admin_access_token),m=await prisma.adminMember.findUnique({where:{id:payload.adminId}});if(!m?.isActive)throw Error('inactive');
  const perms=await module.get(AdminPermissionGuard).getAdminPermissions(m.id);return{code:0,data:{id:m.id,email:m.email,nickname:m.nickname,resolvedPermissions:perms}};}catch{return reply.code(401).send({code:'AUTH_UNAUTHORIZED'});}});
 fastify.get('/api/admin/platform-config',async()=>({code:0,data:{platformConfig:{currency:'CNY'}}}));
 await app.listen(0,'127.0.0.1');fs.writeFileSync(path.join(root,'admin-browser-endpoint.json'),JSON.stringify({url:await app.getUrl(),members}));
 const timer=setInterval(async()=>{if(fs.existsSync(path.join(root,'stop-admin-http'))){clearInterval(timer);await app.close();await prisma.$disconnect();}},100);
}
main().catch(()=>{console.error('owned_browser_fixture_failed');process.exitCode=1;});
