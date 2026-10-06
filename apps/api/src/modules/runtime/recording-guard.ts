import { setTimeout as delay } from 'node:timers/promises';

/**
 * Ordering guard for PCI-safe payment capture: capture is permitted only while recording is
 * confirmed paused by the recorder's ACK, and recording may resume only after capture ends.
 * Any unacknowledged or failed transition fails closed (capture denied). The connector/vendor is
 * injected; real vendor ACK semantics are NOT verified by this module (see DATA_ACCESS doc).
 */
export type RecordingState =
  'recording' | 'pausing' | 'paused' | 'capturing' | 'resuming' | 'failed';
export interface RecorderPort {
  /** Resolves only when the recorder ACKs; rejects/timeouts mean "not paused". */
  pause(signal: AbortSignal): Promise<void>;
  resume(signal: AbortSignal): Promise<void>;
}
export class RecordingGuardError extends Error {
  constructor(
    readonly code:
      'VERBIS_RECORDING_NOT_PAUSED' | 'VERBIS_RECORDING_BUSY' | 'VERBIS_RECORDING_RESUME_FAILED',
  ) {
    super(code);
  }
}
export class RecordingGuard {
  #state: RecordingState = 'recording';
  constructor(
    private readonly recorder: RecorderPort,
    private readonly ackTimeoutMs = 5000,
  ) {}
  get state(): RecordingState {
    return this.#state;
  }
  async #ack(action: (signal: AbortSignal) => Promise<void>): Promise<boolean> {
    const controller = new AbortController();
    try {
      return await Promise.race([
        action(controller.signal).then(() => true),
        delay(this.ackTimeoutMs, false, { signal: controller.signal }),
      ]);
    } catch {
      return false;
    } finally {
      controller.abort();
    }
  }
  /** Runs `capture` strictly between a pause ACK and a resume ACK. */
  async withPausedRecording<T>(capture: () => Promise<T>): Promise<T> {
    if (this.#state !== 'recording') throw new RecordingGuardError('VERBIS_RECORDING_BUSY');
    this.#state = 'pausing';
    if (!(await this.#ack((s) => this.recorder.pause(s)))) {
      this.#state = 'failed';
      throw new RecordingGuardError('VERBIS_RECORDING_NOT_PAUSED');
    }
    this.#state = 'capturing';
    const outcome = await Promise.resolve()
      .then(capture)
      .then(
        (value) => ({ ok: true, value }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
    this.#state = 'resuming';
    this.#state = (await this.#ack((signal) => this.recorder.resume(signal)))
      ? 'recording'
      : 'failed';
    if (!outcome.ok) throw outcome.error;
    if (this.#state === 'failed') throw new RecordingGuardError('VERBIS_RECORDING_RESUME_FAILED');
    return outcome.value;
  }
}
