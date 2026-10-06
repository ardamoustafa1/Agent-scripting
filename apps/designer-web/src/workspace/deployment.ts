export interface DeploymentContext {
  environment: 'dev' | 'test' | 'prod';
  urls: Partial<Record<'dev' | 'test' | 'prod', string>>;
}
export const deployment: DeploymentContext =
  typeof __VERBIS_DESIGNER_DEPLOYMENT__ === 'undefined'
    ? { environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev', urls: {} }
    : __VERBIS_DESIGNER_DEPLOYMENT__;
export function switchEnvironment(environment: 'dev' | 'test' | 'prod') {
  const url = deployment.urls[environment];
  if (url) window.location.assign(url);
}
