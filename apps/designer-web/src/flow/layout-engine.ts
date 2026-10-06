import ELKConstructor, { type ELK } from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';

let engine: ELK | undefined;
/** Layout runs off the main thread; the algorithm worker is fetched only on first layout. */
export function layoutEngine(): Promise<ELK> {
  engine ??= new ELKConstructor({ workerFactory: () => new Worker(workerUrl) });
  return Promise.resolve(engine);
}
