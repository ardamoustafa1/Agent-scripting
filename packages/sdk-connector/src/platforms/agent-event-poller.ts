/** NICE get-next-event port: session and cursor are owned by the server bridge. */
export interface AgentEventBatch {
  readonly cursor: string;
  readonly events: readonly unknown[];
}
export interface AgentEventPollApi {
  next(cursor: string | undefined, signal: AbortSignal): Promise<AgentEventBatch>;
  /** Commit only after the complete batch reaches durable JetStream. */
  commit(cursor: string): Promise<void>;
}
export class AgentEventPoller {
  #cursor: string | undefined;
  #pending: AgentEventBatch | undefined;
  #index = 0;
  #running = false;
  constructor(
    private readonly api: AgentEventPollApi,
    private readonly publish: (event: unknown) => Promise<void>,
  ) {}
  async pollOnce(signal: AbortSignal): Promise<void> {
    if (this.#running) throw new Error('Poll already in progress');
    this.#running = true;
    try {
      this.#pending ??= await this.api.next(this.#cursor, signal);
      while (this.#index < this.#pending.events.length) {
        if (signal.aborted) return;
        await this.publish(this.#pending.events[this.#index]);
        this.#index += 1;
      }
      await this.api.commit(this.#pending.cursor);
      this.#cursor = this.#pending.cursor;
      this.#pending = undefined;
      this.#index = 0;
    } finally {
      this.#running = false;
    }
  }
}
