import { Module } from '@nestjs/common';
import { AdminRepository } from './admin.repository';
import { AdminActivityLogService } from './admin-activity-log.service';

@Module({
  providers: [AdminRepository, AdminActivityLogService],
  exports: [AdminRepository, AdminActivityLogService],
})
export class AdminCoreModule {}
