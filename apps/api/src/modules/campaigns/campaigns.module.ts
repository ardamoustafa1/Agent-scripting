import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';

import { CampaignsController } from './campaigns.controller.js';
import { CampaignsRepository } from './campaigns.repository.js';
import { CampaignsService } from './campaigns.service.js';

@Module({
  imports: [AuditModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsRepository],
})
export class CampaignsModule {}
