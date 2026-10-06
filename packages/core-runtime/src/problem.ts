export class RuntimeProblem extends Error {
  readonly type = 'https://errors.verbis.io/runtime';
  readonly title = 'Runtime operation failed';
  readonly status = 422;
  readonly detail = 'runtime.error';
  constructor(readonly code: string) {
    super(code);
    this.name = 'RuntimeProblem';
  }
}
export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new RuntimeProblem('VERBIS_RUNTIME_CANCELLED');
}
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(new RuntimeProblem('VERBIS_RUNTIME_CANCELLED'));
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}
