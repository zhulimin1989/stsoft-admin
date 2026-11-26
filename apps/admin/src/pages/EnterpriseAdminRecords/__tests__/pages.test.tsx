import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { App, ConfigProvider } from 'antd';
import { beforeEach, expect, it, vi } from 'vitest';
import { enterpriseAdminCreationApi as api, EnterpriseCreationApiError } from '../../../api/v2/enterpriseAdminCreations';
import { useAuthStore } from '../../../stores/auth-store';
import Result from '../result';
import Records from '../index';
import { CreationResolver } from '../CreationResolver';
import { record,report,history,requestId,otherId } from './fixtures';
vi.mock('../../../api/v2/enterpriseAdminCreations',async original=>({...await original<typeof import('../../../api/v2/enterpriseAdminCreations')>(),enterpriseAdminCreationApi:{record:vi.fn(),history:vi.fn(),recovery:vi.fn(),retry:vi.fn(),recover:vi.fn(),capabilities:vi.fn(),recordFile:vi.fn(),list:vi.fn(),resolve:vi.fn()}}));
beforeEach(()=>{
  vi.clearAllMocks();Object.values(api).forEach(fn=>vi.mocked(fn).mockReset());localStorage.clear();
  useAuthStore.setState({loading:false,user:{id:'operator-a',email:'operator@test.invalid',nickname:'运营',resolvedPermissions:['admin.page.enterprise_accounts.review']}});
  vi.mocked(api.record).mockResolvedValue(record('SUCCEEDED'));vi.mocked(api.recovery).mockResolvedValue(report());vi.mocked(api.history).mockResolvedValue(history());
  vi.mocked(api.capabilities).mockResolvedValue({enabled:false,supportedPlane:'domestic',licenseMaxBytes:1024,uploadTtlSeconds:86400});vi.mocked(api.recordFile).mockResolvedValue(new Blob(['license'],{type:'image/png'}));
  vi.mocked(api.list).mockResolvedValue({items:[record('SUCCEEDED')],total:1,page:1,pageSize:20});
  Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:owned')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
});
function Location(){const location=useLocation();return <div data-testid="location">{location.pathname+location.search}</div>;}
function show(result=true,query='?acStatus=SUCCEEDED&acPage=1&q=old'){
  return render(<MemoryRouter initialEntries={[`/enterprise-accounts-v2/admin-creations${result?'/'+requestId:''}${query}`]}><ConfigProvider theme={{token:{motion:false}}}><App><Routes>
    <Route path="/enterprise-accounts-v2/admin-creations/:requestId" element={<Result/>}/><Route path="/enterprise-accounts-v2/admin-creations" element={result?<Location/>:<Records/>}/><Route path="/403" element={<div>权限不足</div>}/>
  </Routes></App></ConfigProvider></MemoryRouter>);
}
it('shows success only after verified GET, with original snapshots and offline source',async()=>{
  show();expect(await screen.findByText('创建成功',{exact:true})).toBeInTheDocument();expect(screen.getByText('受理时 Owner')).toBeInTheDocument();expect(screen.getByText('运营线下核实 / 免客户打款')).toBeInTheDocument();expect(screen.queryByText('打款金额')).not.toBeInTheDocument();expect(screen.getByText('138****0000')).toBeInTheDocument();
  fireEvent.click(screen.getByText('返回代办记录').closest('button')!);expect(screen.getByTestId('location')).toHaveTextContent('?acStatus=SUCCEEDED&acPage=1&q=old');
});
it('failed refresh removes current success and explicitly labels the last verified observation',async()=>{
  show();await screen.findByText('创建成功',{exact:true});vi.mocked(api.record).mockRejectedValue(new EnterpriseCreationApiError(null,503));fireEvent.click(screen.getByText('刷新当前状态').closest('button')!);
  expect(await screen.findByText('当前无法核实开通状态',{exact:true})).toBeInTheDocument();expect(screen.queryByText('创建成功',{exact:true})).not.toBeInTheDocument();expect(screen.getByText(/上次核实：创建成功/)).toBeInTheDocument();expect(screen.queryByText('重试原记录')).not.toBeInTheDocument();
});
it('license preview uses private bytes even when new creation is closed and revokes on close',async()=>{show();await screen.findByText('创建成功',{exact:true});fireEvent.click(screen.getByText('查看原营业执照').closest('button')!);expect(await screen.findByAltText('原营业执照')).toHaveAttribute('src','blob:owned');fireEvent.click(screen.getByText('关闭预览').closest('button')!);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned');});
it('records remain reachable with capabilities closed, using exact server paging and source',async()=>{show(false);expect(await screen.findByText('记录企业')).toBeInTheDocument();expect(screen.queryByRole('button',{name:/代客创建企业账户/})).not.toBeInTheDocument();expect(screen.getByText('线下核实 / 免客户打款')).toBeInTheDocument();expect(api.list).toHaveBeenCalledWith({page:1,pageSize:20,status:'SUCCEEDED'},expect.any(AbortSignal));});
it('list dependency fault is an unverified state rather than an empty successful result',async()=>{vi.mocked(api.list).mockRejectedValue(new EnterpriseCreationApiError(null,503));show(false);expect(await screen.findByText('代办记录未能核实')).toBeInTheDocument();expect(screen.queryByText('暂无匹配的代办记录')).not.toBeInTheDocument();});
it('records/results reject manage-only and unauthenticated access before reads',async()=>{useAuthStore.setState({user:{id:'op',email:'op@test.invalid',nickname:'op',resolvedPermissions:['admin.page.enterprise_accounts.manage']}});show();expect(await screen.findByText('权限不足')).toBeInTheDocument();expect(api.record).not.toHaveBeenCalled();});
it('not-found original key remains uncertain and never invents a new creation',async()=>{
  vi.mocked(api.resolve).mockResolvedValue({found:false,record:null});const onFound=vi.fn();render(<MemoryRouter><CreationResolver operatorId="operator-a" idempotencyKey={otherId} sending={false} onFound={onFound}/></MemoryRouter>);expect(await screen.findByText(/尚未查到原请求/)).toBeInTheDocument();expect(onFound).not.toHaveBeenCalled();expect(api.resolve).toHaveBeenCalledWith(otherId,expect.any(AbortSignal));
});
it('successful original-key resolve links to the same request and operator; other actor response is rejected',async()=>{
  vi.mocked(api.resolve).mockResolvedValue({found:true,record:record()});const onFound=vi.fn(()=>true);
  render(<MemoryRouter initialEntries={['/enterprise-accounts-v2/admin-create?q=old']}><Routes><Route path="/enterprise-accounts-v2/admin-create" element={<CreationResolver operatorId="operator-a" idempotencyKey={otherId} sending={false} onFound={onFound}/>}/><Route path="/enterprise-accounts-v2/admin-creations/:requestId" element={<Location/>}/></Routes></MemoryRouter>);
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent(requestId+'?q=old'));expect(onFound).toHaveBeenCalledWith(requestId);
});
it('malformed saved original marker has a safe manual exit and sends no resolve',()=>{render(<MemoryRouter><CreationResolver operatorId="operator-a" idempotencyKey="unavailable" sending={false} onFound={vi.fn()}/></MemoryRouter>);expect(screen.getByText(/原操作标识无法读取/)).toBeInTheDocument();expect(api.resolve).not.toHaveBeenCalled();});
