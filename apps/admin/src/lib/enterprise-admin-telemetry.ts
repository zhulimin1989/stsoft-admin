// New record filters contain business identifiers; never attach their query/body or UI state to telemetry.
export function isEnterpriseUi(path:string){return /^\/enterprise-accounts-v2\/admin-(create|creations)(?:\/|$)/.test(path);}
function safePath(raw:unknown){
  if(typeof raw!=='string')return undefined;
  try{const url=new URL(raw,'https://admin.local');if(!['http:','https:'].includes(url.protocol))return undefined;
    const path=url.pathname;
    if(path.startsWith('/enterprise-accounts-v2/admin-creations/'))return '/enterprise-accounts-v2/admin-creations/:requestId';
    const prefix='/api/admin/v2/enterprise-accounts/admin-creations';
    if(path.startsWith(prefix+'/')){const suffix=path.slice(prefix.length+1).split('/');
      if(['capabilities','resolve','check','owner-lookup','upload-sessions','recovery-inspection'].includes(suffix[0])&&suffix.length===1)return prefix+'/'+suffix[0];
      if(suffix[0]==='upload-sessions')return prefix+'/upload-sessions/:sessionId/license'+(suffix.length>3?'/:uploadId/file':'');
      return prefix+'/:requestId/'+(['retry','recover','recovery','history','license-file'].includes(suffix.at(-1)!)?suffix.at(-1):'resource');
    }
    return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,':id');
  }catch{return undefined;}
}
export function sanitizeEnterpriseUiTelemetry<T>(event:T,pathname:string):T {
  const source=event as Record<string,any>;
  if(!isEnterpriseUi(pathname)&&!String(source.request?.url||'').includes('/admin/v2/enterprise-accounts/admin-creations'))return event;
  const result:Record<string,any>={...source};
  delete result.extra;delete result.contexts;delete result.breadcrumbs;delete result.logentry;delete result.user;
  delete result.fingerprint;result.logger='enterprise_admin_ui';
  result.message='enterprise_admin_ui';result.transaction=safePath(source.transaction)||safePath(pathname);
  if(source.request)result.request={url:safePath(source.request.url),method:/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(source.request.method)?source.request.method:undefined};
  if(source.exception)result.exception={values:source.exception.values?.map((value:any)=>({type:'Error',value:'enterprise_admin_ui_error',
    stacktrace:value.stacktrace?{frames:value.stacktrace.frames?.map((frame:any)=>({filename:safePath(frame.filename),lineno:frame.lineno,colno:frame.colno}))}:undefined}))};
  if(source.spans)result.spans=source.spans.map((span:any)=>({trace_id:span.trace_id,span_id:span.span_id,parent_span_id:span.parent_span_id,start_timestamp:span.start_timestamp,timestamp:span.timestamp,op:'enterprise_admin_ui',description:'enterprise_admin_ui',status:span.status}));
  result.tags={app:'admin'};
  return result as T;
}
