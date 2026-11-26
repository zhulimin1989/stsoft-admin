import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from 'antd';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({list:vi.fn(),hazards:vi.fn()}));
vi.mock('../../../api/v2/enterpriseAccounts',()=>({enterpriseAccountApi:{listReviewApplications:mocks.list,listRecoveryHazards:mocks.hazards}}));
vi.mock('../../../hooks/usePermission',()=>({usePermission:()=>true}));
// Table rendering is already covered separately; expose its actual pagination controls to test routing.
vi.mock('../../EnterpriseAccounts/components/ReviewApplicationsTable',()=>({ReviewApplicationsTable:({pagination}:any)=><><span>第{pagination.current}页/{pagination.pageSize}条</span><button onClick={()=>pagination.onChange(4,20)}>下一页</button></>}));
import { ReviewQueuePanel } from '../ReviewQueuePanel';
function Location(){return <div data-testid="query">{useLocation().search}</div>;}
beforeEach(()=>{mocks.list.mockReset().mockImplementation(async({page,pageSize})=>({items:[],total:100,page,pageSize}));mocks.hazards.mockResolvedValue({items:[]});});
function show(query='?tab=review'){return render(<MemoryRouter initialEntries={['/enterprise-accounts-v2'+query]}><App><ReviewQueuePanel/><Location/></App></MemoryRouter>);}
it('restores approved filter and pagination from preserved create-return URL',async()=>{show('?tab=review&reviewStatus=APPROVED&reviewPage=3&reviewPageSize=20&q=keep');await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({page:3,pageSize:20,reviewStatus:'APPROVED'}));expect(screen.getByText('第3页/20条')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({page:4,pageSize:20,reviewStatus:'APPROVED'}));expect(screen.getByTestId('query')).toHaveTextContent('q=keep');expect(screen.getByTestId('query')).toHaveTextContent('reviewPage=4');});
it('preserves old default pending-review query and final failure semantics',async()=>{show();await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({page:1,pageSize:10,reviewStatus:'PENDING_REVIEW'}));fireEvent.click(screen.getByRole('button',{name:'开通失败(FINAL)'}));await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({page:1,pageSize:10,reviewStatus:'APPROVED',provisioningStatus:'FAILED_FINAL'}));expect(screen.getByTestId('query')).toHaveTextContent('reviewFinal=1');});
it('malformed return pagination cannot become a fractional or unlimited request',async()=>{show('?tab=review&reviewStatus=invalid&reviewPage=2.5&reviewPageSize=500');await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({page:2,pageSize:100,reviewStatus:'PENDING_REVIEW'}));});
