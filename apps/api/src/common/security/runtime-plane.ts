import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type RuntimePlane = 'admin';

const ADMIN_API_PREFIXES = [
  '/api/health',
  '/api/docs',
  '/api/admin',
  '/api/admin/v2',
  '/api/metrics',
] as const;

function requestPath(url: string): string {
  return url.split('?', 1)[0] || '/';
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isRuntimePlanePathAllowed(plane: RuntimePlane, path: string): boolean {
  void plane;
  return ADMIN_API_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

export async function registerRuntimePlaneGuard(
  fastify: FastifyInstance,
  plane: RuntimePlane,
): Promise<void> {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = requestPath(request.url);
    if (isRuntimePlanePathAllowed(plane, path)) return;

    await reply.code(404).send({
      code: 'NOT_FOUND',
      message: 'Not Found',
      data: null,
    });
  });
}
