import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { LaunchModule } from '../launch/launch.module.js';
import { RuntimeModule } from '../runtime/runtime.module.js';

import { ConnectorHubController } from './connector-hub.controller.js';
import { ConnectorHubService } from './connector-hub.service.js';
import { ConnectorsController } from './connectors.controller.js';
import { ConnectorsRepository } from './connectors.repository.js';
import { ConnectorsService } from './connectors.service.js';
import { GenesysCloudOAuthController } from './genesys-cloud/genesys-cloud-oauth.controller.js';
import { GenesysUserLinkService } from './genesys-cloud/genesys-user-link.service.js';
import { AttachedDataMapService } from './genesys-engage/attached-data-map.service.js';
import { EngageAgentLinkService } from './genesys-engage/engage-agent-link.service.js';
import {
  AttachedDataMapController,
  GenesysEngageAgentController,
  GenesysEngageHubController,
} from './genesys-engage/genesys-engage.controller.js';
import { HubClient } from './hub-client.js';
import { HubPlatformVerifier } from './hub-platform-verifier.js';
import { HubRuntimeBridge } from './hub-runtime-bridge.js';
import { SimulatorController } from './simulator.controller.js';

@Module({
  imports: [AuditModule, IdentityModule, IntegrationsModule, LaunchModule, RuntimeModule],
  controllers: [
    ConnectorsController,
    ConnectorHubController,
    SimulatorController,
    GenesysCloudOAuthController,
    GenesysEngageAgentController,
    GenesysEngageHubController,
    AttachedDataMapController,
  ],
  providers: [
    ConnectorsService,
    ConnectorsRepository,
    ConnectorHubService,
    HubClient,
    HubPlatformVerifier,
    HubRuntimeBridge,
    GenesysUserLinkService,
    EngageAgentLinkService,
    AttachedDataMapService,
  ],
  exports: [HubClient],
})
export class ConnectorsModule {}
