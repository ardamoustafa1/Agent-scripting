import { marketplaceLaunchUrl } from '@verbis/sdk-connector/launch';

/** Call after loading Microsoft's CIF library inside the configured channel provider. */
export async function mountDynamicsProvider({
  cif,
  container,
  agentOrigin,
  frameTitle,
  launchCode,
}) {
  if (!cif || typeof cif.getEnvironment !== 'function') throw new Error('CIF host required');
  await cif.getEnvironment(); // Confirms host readiness; never use CRM user/record as launch proof.
  const frame = container.ownerDocument.createElement('iframe');
  frame.src = marketplaceLaunchUrl(agentOrigin, launchCode);
  frame.title = frameTitle; // Pass the host's tr/en localized accessible name.
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  frame.referrerPolicy = 'no-referrer';
  frame.style.width = '100%';
  frame.style.height = '100%';
  frame.style.border = '0';
  container.appendChild(frame);
  return () => frame.remove();
}
