/** Errors connectors throw. `retryable` drives the hub's reconnect / retry-with-backoff policy. */
export class ConnectorError extends Error {
  override readonly name: string = 'ConnectorError';

  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class CommandNotSupportedError extends ConnectorError {
  override readonly name = 'CommandNotSupportedError';

  constructor(command: string) {
    super(`Command ${command} is not supported by this connector`, 'command_not_supported', false);
  }
}

export class UnknownInteractionError extends ConnectorError {
  override readonly name = 'UnknownInteractionError';

  constructor() {
    super('Interaction is unknown to this connector', 'interaction_unknown', false);
  }
}

export class PayloadRejectedError extends ConnectorError {
  override readonly name = 'PayloadRejectedError';

  constructor(reason: string) {
    super(`Platform payload rejected: ${reason}`, 'payload_rejected', false);
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ConnectorError ? error.retryable : true;
}
