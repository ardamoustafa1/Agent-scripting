import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';
import { ScriptsModule } from '../scripts/scripts.module.js';

import { AiController } from './ai.controller.js';
import { AiService, AI_PROVIDER } from './ai.service.js';
import { JsonLlmProvider } from './providers.js';

@Module({
  imports: [AuditModule, IntegrationsModule, RuntimeModule, ScriptsModule],
  controllers: [AiController],
  providers: [AiService, { provide: AI_PROVIDER, useClass: JsonLlmProvider }],
})
export class AiModule {}
