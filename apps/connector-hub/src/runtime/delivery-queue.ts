import { backoffDelay, BackpressureError, isRetryable } from '@verbis/sdk-connector';

export interface DeliveryQueueOptions<T> {
  readonly capacity: number;
  readonly concurrency: number;
  readonly maxAttempts?: number;
  /** Partition key: items of one key are delivered strictly in order (one interaction). */
  key(item: T): string;
  handle(item: T): Promise<void>;
  onDeadLetter?(item: T, error: unknown, reason: 'rejected' | 'exhausted'): void;
  sleep?(ms: number): Promise<void>;
  random?(): number;
}

export interface QueueStats {
  readonly depth: number;
  readonly inflight: number;
  readonly capacity: number;
  readonly delivered: number;
  readonly retried: number;
  readonly deadLettered: number;
}

/**
 * Bounded, key-ordered delivery queue (backpressure). `offer` throws `BackpressureError` when full
 * so connectors push back on their platform instead of buffering unboundedly. Failures are retried
 * with jittered exponential backoff while holding the key's order; non-retryable failures or
 * exhausted attempts go to the dead-letter callback (never silently dropped).
 */
export class DeliveryQueue<T> {
  readonly #partitions = new Map<string, T[]>();
  readonly #active = new Set<string>();
  readonly #idle: (() => void)[] = [];
  #size = 0;
  #delivered = 0;
  #retried = 0;
  #dead = 0;
  #closed = false;

  constructor(private readonly options: DeliveryQueueOptions<T>) {}

  offer(item: T): void {
    if (this.#closed) throw new BackpressureError('queue closed');
    if (this.#size >= this.options.capacity) throw new BackpressureError('delivery queue full');
    const key = this.options.key(item);
    const partition = this.#partitions.get(key) ?? [];
    partition.push(item);
    this.#partitions.set(key, partition);
    this.#size += 1;
    this.#pump();
  }

  stats(): QueueStats {
    return {
      depth: this.#size,
      inflight: this.#active.size,
      capacity: this.options.capacity,
      delivered: this.#delivered,
      retried: this.#retried,
      deadLettered: this.#dead,
    };
  }

  /** Resolves when everything offered so far was delivered or dead-lettered. */
  drain(): Promise<void> {
    if (this.#size === 0 && this.#active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  close(): void {
    this.#closed = true;
  }

  /**
   * After `close`: removes and returns every item that has not started delivery (the head of an
   * in-flight partition stays with its worker), so shutdown can persist them instead of losing them.
   */
  takePending(): T[] {
    const pending: T[] = [];
    for (const [key, items] of this.#partitions) {
      const keep = this.#active.has(key) ? 1 : 0;
      pending.push(...items.splice(keep));
      if (items.length === 0) this.#partitions.delete(key);
    }
    this.#size -= pending.length;
    return pending;
  }

  #pump(): void {
    for (const [key, items] of this.#partitions) {
      if (this.#active.size >= this.options.concurrency) return;
      if (this.#active.has(key) || items.length === 0) continue;
      this.#active.add(key);
      void this.#run(key);
    }
  }

  async #run(key: string): Promise<void> {
    const sleep = (ms: number): Promise<void> =>
      this.options.sleep
        ? this.options.sleep(ms)
        : new Promise<void>((r) => setTimeout(r, ms).unref());
    const maxAttempts = this.options.maxAttempts ?? 8;
    const items = this.#partitions.get(key) ?? [];
    while (items.length > 0) {
      const item = items[0] as T;
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.options.handle(item);
          this.#delivered += 1;
          break;
        } catch (error) {
          const retryable = isRetryable(error);
          if (!retryable || attempt + 1 >= maxAttempts) {
            this.#dead += 1;
            this.options.onDeadLetter?.(item, error, retryable ? 'exhausted' : 'rejected');
            break;
          }
          this.#retried += 1;
          await sleep(
            backoffDelay(attempt, {
              baseMs: 200,
              maxMs: 30_000,
              ...(this.options.random === undefined
                ? {}
                : { random: () => this.options.random?.() ?? Math.random() }),
            }),
          );
        }
      }
      items.shift();
      this.#size -= 1;
    }
    this.#partitions.delete(key);
    this.#active.delete(key);
    if (this.#size === 0 && this.#active.size === 0)
      for (const resolve of this.#idle.splice(0)) resolve();
    this.#pump();
  }
}
