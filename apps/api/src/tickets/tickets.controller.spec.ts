import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { UserInternalClient } from '../user/user-internal.client';
import { TicketsController } from './tickets.controller';

describe('TicketsController (admin proxy)', () => {
  let controller: TicketsController;
  let userClient: any;

  beforeEach(async () => {
    userClient = {
      listTickets: jest.fn(),
      createTicket: jest.fn(),
      getTicket: jest.fn(),
      addTicketMessage: jest.fn(),
      changeTicketStatus: jest.fn(),
      assignTicket: jest.fn(),
      changeTicketCategory: jest.fn(),
      changeTicketPriority: jest.fn(),
      closeTicket: jest.fn(),
      mergeTicket: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [{ provide: UserInternalClient, useValue: userClient }],
    })
      .overrideGuard(AdminJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(TicketsController);
  });

  it('list: forwards filters to user service', async () => {
    userClient.listTickets.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    await controller.list({
      page: '2',
      pageSize: '10',
      category: 'BILLING',
      priority: 'HIGH',
      status: 'OPEN',
      assigneeId: 'admin2',
      userId: 'u1',
    });
    expect(userClient.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        pageSize: 10,
        category: 'BILLING',
        priority: 'HIGH',
        status: 'OPEN',
        assigneeId: 'admin2',
        userId: 'u1',
      }),
    );
  });

  it('list: drops invalid enum values silently', async () => {
    userClient.listTickets.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    await controller.list({ category: 'BAD', priority: 'BAD', status: 'BAD' });
    expect(userClient.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        category: undefined,
        priority: undefined,
        status: undefined,
      }),
    );
  });

  it('create: rejects missing fields', async () => {
    await expect(controller.create('admin1', {})).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      controller.create('admin1', { userId: 'u1' }),
    ).rejects.toThrow(/subject/);
    await expect(
      controller.create('admin1', { userId: 'u1', subject: 's' }),
    ).rejects.toThrow(/category/);
    await expect(
      controller.create('admin1', {
        userId: 'u1',
        subject: 's',
        category: 'BAD' as any,
      }),
    ).rejects.toThrow(/category/);
  });

  it('create: passes admin id and content to user service', async () => {
    userClient.createTicket.mockResolvedValueOnce({ id: 't1' });
    await controller.create('admin1', {
      userId: 'u1',
      subject: 'help',
      category: 'BILLING',
      content: 'detail',
    });
    expect(userClient.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        asAdminId: 'admin1',
        content: 'detail',
      }),
    );
  });

  it('reply: forwards internal note flag', async () => {
    userClient.addTicketMessage.mockResolvedValueOnce({ id: 'm1' });
    await controller.reply('admin1', 't1', {
      content: 'note',
      isInternal: true,
    });
    expect(userClient.addTicketMessage).toHaveBeenCalledWith('t1', {
      adminId: 'admin1',
      content: 'note',
      isInternal: true,
      attachments: undefined,
    });
  });

  it('changeStatus / assign / close / merge route through user service', async () => {
    userClient.changeTicketStatus.mockResolvedValueOnce({ id: 't1', status: 'CLOSED' });
    const status = await controller.changeStatus('admin1', 't1', { status: 'CLOSED' });
    expect(userClient.changeTicketStatus).toHaveBeenCalledWith('t1', {
      status: 'CLOSED',
      adminId: 'admin1',
    });
    expect((status.data as any).status).toBe('CLOSED');

    userClient.assignTicket.mockResolvedValueOnce({ id: 't1', assigneeId: null });
    await controller.assign('admin1', 't1', { assigneeId: null });
    expect(userClient.assignTicket).toHaveBeenCalledWith('t1', {
      assigneeId: null,
      adminId: 'admin1',
    });

    userClient.closeTicket.mockResolvedValueOnce({ id: 't1', status: 'CLOSED' });
    await controller.close('admin1', 't1');
    expect(userClient.closeTicket).toHaveBeenCalledWith('t1', 'admin1');

    userClient.mergeTicket.mockResolvedValueOnce({ src: { id: 't1' }, dst: { id: 't2' } });
    const merged = await controller.merge('admin1', 't1', { targetId: 't2' });
    expect(userClient.mergeTicket).toHaveBeenCalledWith('t1', {
      targetId: 't2',
      adminId: 'admin1',
    });
    expect((merged.data as any).dst.id).toBe('t2');
  });

  it('detail: routes to user service', async () => {
    userClient.getTicket.mockResolvedValueOnce({ ticket: { id: 't1' }, messages: [] });
    const r = await controller.detail('t1');
    expect(userClient.getTicket).toHaveBeenCalledWith('t1');
    expect(r.code).toBe(0);
  });
});
