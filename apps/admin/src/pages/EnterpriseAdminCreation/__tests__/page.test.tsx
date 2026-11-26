import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { App, ConfigProvider } from 'antd';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth-store';
import { enterpriseAdminCreationApi as api } from '../../../api/v2/enterpriseAdminCreations';
import Page from '../index';
import { CreationEntry } from '../CreationEntry';
vi.mock('../../../api/v2/enterpriseAdminCreations',async original=>({...await original<typeof import('../../../api/v2/enterpriseAdminCreations')>(),enterpriseAdminCreationApi:{capabilities:vi.fn(),session:vi.fn(),upload:vi.fn(),ownerLookup:vi.fn(),check:vi.fn(),create:vi.fn(),file:vi.fn()}}));
const review='admin.page.enterprise_accounts.review';
const file=new File(['license'],'license.png',{type:'image/png'});
beforeEach(()=>{
  vi.clearAllMocks();Object.values(api).forEach(fn=>vi.mocked(fn).mockReset());localStorage.clear();useAuthStore.setState({loading:false,user:{id:'operator-a',email:'operator@test.invalid',nickname:'运营',resolvedPermissions:[review]}});
  vi.mocked(api.capabilities).mockResolvedValue({enabled:true,supportedPlane:'domestic',licenseMaxBytes:1024,uploadTtlSeconds:3600});
  vi.mocked(api.session).mockResolvedValue({id:'session-a',expiresAt:new Date(Date.now()+60000).toISOString()});
  vi.mocked(api.upload).mockResolvedValue({id:'file-a',sessionId:'session-a',size:file.size,contentType:'image/png',sha256:'a'.repeat(64),expiresAt:new Date(Date.now()+60000).toISOString()});
  vi.mocked(api.ownerLookup).mockResolvedValue({found:true,eligible:true,reasonCode:null,owner:{userId:'user-a',nickname:'客户账号',phoneMasked:'138****0000'}});
  vi.mocked(api.check).mockResolvedValue({available:true});vi.mocked(api.create).mockResolvedValue({requestId:'11111111-1111-4111-8111-111111111111'});
});
function Location(){const location=useLocation();return <div data-testid="location">{location.pathname+location.search}</div>;}
// jsdom does not execute CSS motion. Browser E2E retains the actual animated Modal.
function renderPage(){return render(<MemoryRouter initialEntries={['/enterprise-accounts-v2/admin-create?tab=review&reviewStatus=APPROVED&page=3&q=test']}><ConfigProvider theme={{token:{motion:false}}}><App><Routes><Route path="/enterprise-accounts-v2/admin-create" element={<Page/>}/><Route path="/enterprise-accounts-v2" element={<Location/>}/><Route path="/403" element={<div>权限不足</div>}/></Routes></App></ConfigProvider></MemoryRouter>);}
async function fill(){
  const phone=await screen.findByLabelText('客户提供的手机号');await waitFor(()=>expect(phone).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText('企业名称'),{target:{value:'测试企业'}});
  fireEvent.change(screen.getByLabelText('统一社会信用代码'),{target:{value:'91310000AAAAAAAAAA'}});
  fireEvent.change(screen.getByLabelText('选择营业执照'),{target:{files:[file]}});await screen.findByText('已上传');
  fireEvent.change(phone,{target:{value:'13800000000'}});fireEvent.click(screen.getByRole('button',{name:'精确查找账号'}));
  await screen.findByText('该账号可作为企业 Owner');
}
it('review-only starts with empty mandatory fields and cannot submit',()=>{
  renderPage();expect(screen.getByLabelText('企业名称')).toHaveValue('');expect(screen.getByRole('button',{name:'核对提交资料'})).toBeDisabled();expect(api.create).not.toHaveBeenCalled();
});
it('private upload/owner confirmation displays snapshot and returning to edit never submits',async()=>{
  renderPage();await fill();expect(screen.getByText('138****0000')).toBeInTheDocument();expect(screen.queryByText('个人实名认证')).not.toBeInTheDocument();fireEvent.submit(screen.getByLabelText('企业名称').closest('form')!);
  const dialog=await screen.findByRole('dialog',{name:'提交前核对'});expect(within(dialog).getByText('测试企业')).toBeInTheDocument();fireEvent.click(within(dialog).getByRole('button',{name:'返回修改'}));expect(api.create).not.toHaveBeenCalled();
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'提交前核对'})).not.toBeInTheDocument());expect(screen.getByLabelText('企业名称')).toHaveValue('测试企业');
});
it('confirmation double submit displays 202 only as accepted',async()=>{
  renderPage();await fill();fireEvent.submit(screen.getByLabelText('企业名称').closest('form')!);const submit=(await screen.findByText('确认并提交')).closest('button')!;act(()=>{fireEvent.click(submit);fireEvent.click(submit);});
  expect(await screen.findByText('已受理')).toBeInTheDocument();expect(screen.getByText('11111111-1111-4111-8111-111111111111')).toBeInTheDocument();expect(screen.queryByText('创建成功')).not.toBeInTheDocument();expect(api.create).toHaveBeenCalledTimes(1);
});
it.each([['manage',['admin.page.enterprise_accounts.manage']],['ordinary',[]],['unauthenticated',null]])('direct page rejects %s before fetching capabilities',async(_name,permissions)=>{
  if(permissions===null)useAuthStore.setState({user:null});else useAuthStore.setState({user:{id:'other',email:'other@test.invalid',nickname:'other',resolvedPermissions:permissions}});
  renderPage();expect(await screen.findByText('权限不足')).toBeInTheDocument();expect(api.capabilities).not.toHaveBeenCalled();
});
it.each([false,'failed'])('capability %s keeps form closed and creates no upload session',async mode=>{
  if(mode==='failed')vi.mocked(api.capabilities).mockRejectedValue(Error('raw secret'));else vi.mocked(api.capabilities).mockResolvedValue({enabled:false,supportedPlane:'domestic',licenseMaxBytes:1024,uploadTtlSeconds:3600});
  renderPage();await screen.findByText(mode==='failed'?'创建能力暂时无法确认，请稍后重新进入':'当前暂不开放代客创建');expect(screen.getByLabelText('企业名称')).toBeDisabled();expect(screen.queryByText('raw secret')).not.toBeInTheDocument();expect(api.session).not.toHaveBeenCalled();
});
it('cancel preserves the exact list mode/query/filter/pagination URL and never creates',async()=>{renderPage();await userEvent.click(screen.getByRole('button',{name:/取\s*消/}));expect(await screen.findByTestId('location')).toHaveTextContent('/enterprise-accounts-v2?tab=review&reviewStatus=APPROVED&page=3&q=test');expect(api.create).not.toHaveBeenCalled();});
it('phone edit clears visible owner and disables confirm immediately',async()=>{renderPage();await fill();fireEvent.change(screen.getByLabelText('客户提供的手机号'),{target:{value:'13900000000'}});expect(screen.queryByText('客户账号')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'核对提交资料'})).toBeDisabled();});
it('entry hides until enabled and carries list navigation context',async()=>{
  let resolve!:(value:any)=>void;vi.mocked(api.capabilities).mockReturnValue(new Promise(r=>{resolve=r;}));render(<MemoryRouter initialEntries={['/enterprise-accounts-v2?q=keep&page=4']}><Routes><Route path="/enterprise-accounts-v2" element={<CreationEntry/>}/><Route path="/enterprise-accounts-v2/admin-create" element={<Location/>}/></Routes></MemoryRouter>);
  expect(screen.queryByRole('button',{name:/代客创建企业账户/})).not.toBeInTheDocument();await act(async()=>resolve({enabled:true,supportedPlane:'domestic',licenseMaxBytes:1024,uploadTtlSeconds:3600}));await userEvent.click(await screen.findByRole('button',{name:/代客创建企业账户/}));expect(screen.getByTestId('location')).toHaveTextContent('/enterprise-accounts-v2/admin-create?q=keep&page=4');
});
