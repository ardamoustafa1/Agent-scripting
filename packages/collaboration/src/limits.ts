/** Largest single Yjs update a client may send (ADR-0028/0044, audit M-15). */
export const MAX_UPDATE_BYTES = 2 * 1024 * 1024;
/**
 * Slack for message framing (document name, message type, length prefixes) so the transport
 * frame limit never rejects an update the application limit still allows.
 */
export const FRAME_OVERHEAD_BYTES = 4096;
export const MAX_FRAME_BYTES = MAX_UPDATE_BYTES + FRAME_OVERHEAD_BYTES;
/** RFC 6455 "Message Too Big". */
export const UPDATE_TOO_LARGE_CLOSE_CODE = 1009;
export const UPDATE_TOO_LARGE_REASON = 'Message Too Big';

/** True when `byteLength` is a valid, non-negative size within the per-update limit. */
export function isUpdateWithinLimit(byteLength: number): boolean {
  return Number.isSafeInteger(byteLength) && byteLength >= 0 && byteLength <= MAX_UPDATE_BYTES;
}

/** Thrown for an oversize update; carries the WebSocket close code Hocuspocus will use. */
export class UpdateTooLargeError extends Error {
  readonly code = UPDATE_TOO_LARGE_CLOSE_CODE;
  readonly reason = UPDATE_TOO_LARGE_REASON;
  constructor(readonly size: number) {
    super('Collaboration update exceeds the size limit');
    this.name = 'UpdateTooLargeError';
  }
}

export function assertUpdateWithinLimit(update: { readonly byteLength: number }): void {
  if (!isUpdateWithinLimit(update.byteLength)) throw new UpdateTooLargeError(update.byteLength);
}
