import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ENTERPRISE_ADMIN_PERMISSION, EnterpriseAdminError as E, enterpriseAdminCreationSchema, enterpriseAdminOwnerLookupSchema,
  enterpriseAdminCheckSchema, enterpriseAdminEmptySchema, enterpriseAdminResolveSchema, enterpriseAdminListSchema, enterpriseAdminRecoveryScanSchema, enterpriseAdminHistorySchema } from '@ruidong/shared';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { EnterpriseAdminProxyService } from './enterprise-admin-proxy.service';
import { enterpriseAdminFailure } from './enterprise-admin-http';
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> { const result = schema.safeParse(value); if (!result.success) enterpriseAdminFailure(E.INVALID_INPUT, 400); return result.data; }
const id = (value: string) => parse(z.string().uuid(), value);
@Controller('admin/v2/enterprise-accounts/admin-creations')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class EnterpriseAdminProxyController {
  constructor(private readonly proxy: EnterpriseAdminProxyService) {}
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get('capabilities') async capabilities() { return this.result(await this.proxy.call('GET', '/capabilities')); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post('owner-lookup') async owner(@Body() body: unknown) { return this.result(await this.proxy.call('POST', '/owner-lookup', undefined, parse(enterpriseAdminOwnerLookupSchema, body))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post('check') async check(@Body() body: unknown) { return this.result(await this.proxy.call('POST', '/check', undefined, parse(enterpriseAdminCheckSchema, body))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post('upload-sessions') async session(@Body() body: unknown) { return this.result(await this.proxy.call('POST', '/upload-sessions', undefined, parse(enterpriseAdminEmptySchema, body))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post('upload-sessions/:sessionId/license') async upload(@Param('sessionId') sessionId: string, @Req() req: FastifyRequest) { return this.result(await this.proxy.upload(id(sessionId), req.body, String(req.headers['content-type'] ?? ''))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get('upload-sessions/:sessionId/license/:uploadId/file') async file(@Param('sessionId') sessionId: string, @Param('uploadId') uploadId: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.sendFile(req, reply, signal => this.proxy.file(id(sessionId), id(uploadId), signal));
  }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post() @HttpCode(202) async create(@Body() body: unknown) { return this.result(await this.proxy.call('POST', '', undefined, parse(enterpriseAdminCreationSchema, body))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post('resolve') async resolve(@Body() body: unknown) { return this.result(await this.proxy.call('POST', '/resolve', undefined, parse(enterpriseAdminResolveSchema, body))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get() async list(@Query() query: unknown) { return this.result(await this.proxy.call('GET', '', parse(enterpriseAdminListSchema, query))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get('recovery-inspection') async inspect(@Query() query: unknown) { return this.result(await this.proxy.call('GET', '/recovery-inspection', parse(enterpriseAdminRecoveryScanSchema, query))); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get(':requestId') async record(@Param('requestId') requestId: string) { return this.result(await this.proxy.call('GET', `/${id(requestId)}`, undefined, undefined, requestId)); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post(':requestId/retry') @HttpCode(202) async retry(@Param('requestId') requestId: string, @Body() body: unknown) { return this.result(await this.proxy.call('POST', `/${id(requestId)}/retry`, undefined, parse(enterpriseAdminEmptySchema, body), requestId)); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Post(':requestId/recover') @HttpCode(202) async recover(@Param('requestId') requestId: string, @Body() body: unknown) { return this.result(await this.proxy.call('POST', `/${id(requestId)}/recover`, undefined, parse(enterpriseAdminEmptySchema, body), requestId)); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get(':requestId/recovery') async recovery(@Param('requestId') requestId: string) { return this.result(await this.proxy.call('GET', `/${id(requestId)}/recovery`, undefined, undefined, requestId)); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get(':requestId/history') async history(@Param('requestId') requestId: string, @Query() query: unknown) { return this.result(await this.proxy.call('GET', `/${id(requestId)}/history`, parse(enterpriseAdminHistorySchema,query), undefined, requestId)); }
  @RequireAdminPermission(ENTERPRISE_ADMIN_PERMISSION) @Get(':requestId/license-file') async recordFile(@Param('requestId') requestId: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.sendFile(req, reply, signal => this.proxy.recordFile(id(requestId), signal));
  }
  private result(data: unknown) { return { code: 0, message: 'ok', data }; }
  private async sendFile(req: FastifyRequest, reply: FastifyReply, read: (signal: AbortSignal) => Promise<{ buffer: Buffer; contentType: string | null; filename: string | null }>) {
    const ctrl = new AbortController(), abort = () => { if (!reply.raw.writableEnded) ctrl.abort(); };
    req.raw.once('aborted', abort); reply.raw.once('close', abort);
    try { const file = await read(ctrl.signal), name = file.filename ?? 'license';
      return reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', 'sandbox')
        .header('Content-Type', file.contentType!).header('Content-Length', String(file.buffer.length))
        .header('Content-Disposition', `inline; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`).send(file.buffer);
    } finally { req.raw.off('aborted', abort); reply.raw.off('close', abort); }
  }
}
