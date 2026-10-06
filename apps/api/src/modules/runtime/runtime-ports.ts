import { Injectable } from '@nestjs/common';

import { ConflictError } from '../../common/errors/domain-errors.js';

export interface RuntimeConnector {
  /** Adapters MUST deduplicate the stable commandId across retries. */
  writeOutcome(input: {
    tenantId: string;
    interactionId: string;
    commandId: string;
    code: string;
    subCodes: string[];
    note?: string;
    fields: Record<string, unknown>;
    callbackAt?: string;
  }): Promise<void>;
  pauseRecording(input: {
    tenantId: string;
    interactionId: string;
    commandId: string;
    paused: boolean;
  }): Promise<void>;
}
export interface SecureTokenVerifier {
  verify(input: {
    tenantId: string;
    sessionId: string;
    variable: string;
    receipt: string;
  }): Promise<{ token: string }>;
}
/** Server-only registry. No client can register a connector or token verifier. */
@Injectable()
export class RuntimePorts {
  readonly #connectors = new Map<string, RuntimeConnector>();
  #fallback: ((connectorId: string) => RuntimeConnector) | undefined;
  #verifier: SecureTokenVerifier | undefined;
  registerConnector(connectorId: string, connector: RuntimeConnector): void {
    this.#connectors.set(connectorId, connector);
  }
  registerFallbackConnector(factory: (connectorId: string) => RuntimeConnector): void {
    this.#fallback = factory;
  }
  registerTokenVerifier(verifier: SecureTokenVerifier): void {
    this.#verifier = verifier;
  }
  connector(id: string): RuntimeConnector {
    const connector = this.#connectors.get(id) ?? this.#fallback?.(id);
    if (connector === undefined) throw new ConflictError('Runtime connector is not configured');
    return connector;
  }
  async verify(input: Parameters<SecureTokenVerifier['verify']>[0]): Promise<{ token: string }> {
    if (this.#verifier === undefined)
      throw new ConflictError('Secure token provider is not configured');
    const result = await this.#verifier.verify(input);
    if (!/^tok_(?![A-Za-z0-9_-]*[0-9]{13})[A-Za-z0-9_-]{16,512}$/.test(result.token))
      throw new ConflictError('Invalid token provider response');
    return result;
  }
}
