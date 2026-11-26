import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      host: config.get('REDIS_HOST', 'localhost'),
      port: config.get('REDIS_PORT', 6379),
      password: config.get('REDIS_PASSWORD'),
      // AWS ElastiCache Valkey transit_encryption=true 强制 TLS;非生产/无 TLS 时跳过。
      // REDIS_TLS_REJECT_UNAUTHORIZED=false 时只加密不校验证书:阿里云 Tair 用自有 CA,
      // 不在 Node 信任链,内网 VPC 下跳过校验;默认仍校验(AWS 公共 CA 不受影响)。
      tls:
        config.get<string>('REDIS_TLS') === 'true'
          ? { rejectUnauthorized: config.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED') !== 'false' }
          : undefined,
    });
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
