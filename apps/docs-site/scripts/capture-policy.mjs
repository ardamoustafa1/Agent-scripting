import path from 'node:path';

export function validateCapture(manifest, origins, authDir, repo) {
  if (manifest.syntheticOnly !== true || !Array.isArray(manifest.steps) || !manifest.steps.length)
    throw new Error('Capture requires an explicit synthetic-only manifest with steps');
  if (!path.isAbsolute(authDir) || authDir === repo || authDir.startsWith(repo + path.sep))
    throw new Error('Auth states must be kept in an absolute directory outside the repository');
  const allowed = new Set(
    origins.map((origin) => {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
        throw new Error('Allowlist entries must be exact HTTP(S) origins');
      return origin;
    }),
  );
  const names = new Set();
  return manifest.steps.map((step) => {
    const url = new URL(step.url);
    if (!allowed.has(url.origin) || url.username || url.password || url.search || url.hash)
      throw new Error(
        'Capture URL must use an allowed origin with no credentials, query or fragment',
      );
    if (!/^(designer|agent|admin)-[a-z0-9-]+-(tr|en)$/.test(step.name) || names.has(step.name))
      throw new Error('Screenshot names must be unique, localized guide names');
    names.add(step.name);
    if (
      !/^[a-z0-9-]+\.json$/.test(step.authState) ||
      typeof step.readySelector !== 'string' ||
      !step.readySelector
    )
      throw new Error('Capture requires a basename-only storage state and ready selector');
    if (
      step.mask !== undefined &&
      (!Array.isArray(step.mask) || step.mask.some((item) => typeof item !== 'string'))
    )
      throw new Error('Mask selectors must be strings');
    return { ...step, url: url.href, authState: path.join(authDir, step.authState) };
  });
}
