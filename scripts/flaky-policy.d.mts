export interface QuarantineEntry {
  project: string;
  file: string;
  title: string;
  owner: string;
  reason: string;
  issue: string;
  createdAt: string;
  expiresAt: string;
}
export interface QuarantineManifest {
  version: 1;
  entries: QuarantineEntry[];
}
export function validateQuarantine(manifest: unknown, now?: Date): string[];
export function loadQuarantine(): Promise<QuarantineManifest>;
