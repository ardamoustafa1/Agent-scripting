import type { DeploymentContext } from './workspace/deployment.js';

declare global {
  const __VERBIS_DESIGNER_DEPLOYMENT__: DeploymentContext;
}
export {};
