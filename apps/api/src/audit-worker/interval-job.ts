import { Logger } from '@nestjs/common';

/**
 * Runs `tick` every `intervalMs`, never overlapping itself; `wake()` triggers an early run (e.g.
 * on LISTEN/NOTIFY). Errors are logged (type only) and the loop continues.
 */
export class IntervalJob {
  readonly #logger: Logger;
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  #again = false;
  #stopped = true;

  constructor(
    readonly name: string,
    private readonly intervalMs: number,
    private readonly tick: () => Promise<void>,
  ) {
    this.#logger = new Logger(`AuditWorker:${name}`);
  }

  /** Read through a method: `stop()` may run while a tick is awaited. */
  isStopped(): boolean {
    return this.#stopped;
  }

  start(): void {
    this.#stopped = false;
    this.#schedule(0);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
  }

  wake(): void {
    if (this.#stopped) return;
    if (this.#running) {
      this.#again = true;
      return;
    }
    this.#schedule(0);
  }

  /** Runs one tick now (tests, manual triggers). */
  async runOnce(): Promise<void> {
    await this.tick();
  }

  #schedule(delay: number): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#run(), delay);
    this.#timer.unref();
  }

  async #run(): Promise<void> {
    if (this.#stopped || this.#running) return;
    this.#running = true;
    try {
      await this.tick();
    } catch (error) {
      this.#logger.error(`tick failed: ${error instanceof Error ? error.name : 'unknown'}`);
    } finally {
      this.#running = false;
      if (!this.isStopped()) this.#schedule(this.#again ? 0 : this.intervalMs);
      this.#again = false;
    }
  }
}
