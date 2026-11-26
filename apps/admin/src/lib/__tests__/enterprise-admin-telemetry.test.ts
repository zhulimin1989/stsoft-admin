import { expect,it } from 'vitest';
import { sanitizeEnterpriseUiTelemetry } from '../enterprise-admin-telemetry';
it('removes record queries, body/context/logs and raw stack variables from new UI telemetry',()=>{
  const secret='private_business_marker';const event={request:{url:'https://admin.local/api/admin/v2/enterprise-accounts/admin-creations?uscc='+secret,headers:{cookie:secret},data:secret},
    user:{email:secret},extra:{input:secret},contexts:{data:secret},breadcrumbs:[{data:secret}],tags:{phone:secret},message:secret,
    exception:{values:[{value:secret,stacktrace:{frames:[{filename:'/assets/code.js?secret='+secret,vars:{phone:secret},context_line:secret}]}}]},
    spans:[{description:secret,data:{phone:secret},trace_id:'opaque',span_id:'opaque',timestamp:1}]};
  const value=sanitizeEnterpriseUiTelemetry(event,'/enterprise-accounts-v2/admin-creations');expect(JSON.stringify(value)).not.toContain(secret);expect(value.request.url).not.toContain('?');expect(value.message).toBe('enterprise_admin_ui');
});
it('preserves telemetry for unrelated pages',()=>{const event={message:'other-page'};expect(sanitizeEnterpriseUiTelemetry(event,'/orders')).toBe(event);});
it('does not leak malformed record IDs or blob/data URLs as stack filenames',()=>{
  const marker='private_marker';const event={transaction:'/enterprise-accounts-v2/admin-creations/'+marker,exception:{values:[{stacktrace:{frames:[{filename:'data:text/plain,'+marker},{filename:'blob:https://admin.local/'+marker}]}}]},fingerprint:[marker]};
  const cleaned=sanitizeEnterpriseUiTelemetry(event,'/enterprise-accounts-v2/admin-creations/'+marker);expect(JSON.stringify(cleaned)).not.toContain(marker);expect(cleaned.transaction).toBe('/enterprise-accounts-v2/admin-creations/:requestId');
});
