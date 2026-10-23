import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';

import { KnowledgeDesktopController } from './knowledge-desktop.controller.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

/** In-script knowledge base (ADR-0057). */
@Module({
  imports: [AuditModule, RuntimeModule],
  controllers: [KnowledgeController, KnowledgeDesktopController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
