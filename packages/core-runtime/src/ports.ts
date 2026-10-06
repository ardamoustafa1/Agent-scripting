import type { Action, JsonValue, PreviewStep } from '@verbis/script-schema';

import type { ServerValidationHook, FieldValidationHook } from './validation.js';

/** Metadata only. Never contains props, expression text, variable values or upstream errors. */
export interface RuntimeSessionEvent {
  sequence: number;
  action: Action['type'] | 'component' | 'rule' | 'page' | 'flow' | 'dataSource';
  phase: 'started' | 'completed' | 'failed' | 'cancelled' | 'waiting';
  simulation: boolean;
  timestamp?: number;
  durationMs?: number;
  path?: string;
  flow?: string;
  edge?: string;
  code?: string;
  node?: string;
}
export interface DataSourceRequest {
  id: string;
  ref: string;
  version: number;
  inputs: Record<string, JsonValue>;
  signal: AbortSignal;
}
export type ExternalAction = Extract<
  Action,
  {
    type:
      | 'submitOutcome'
      | 'setDisposition'
      | 'writeBackToPlatform'
      | 'transferHint'
      | 'emitEvent'
      | 'logEvent';
  }
>;
/** Implement behind an authenticated BFF. Server rechecks tenant, capabilities, redaction and audit. */
export interface RuntimePorts {
  /** Values and customer data are forbidden. Host persists bounded node timing/read metadata. */
  telemetry?: (metadata: {
    type: 'field.observed' | 'text.acknowledged';
    name: string;
    status: 'success' | 'failure';
    durationMs: number;
  }) => void;
  /** Agent host may fence navigation until field drafts are durably synchronized. */
  navigationGuard?: () => void | Promise<void>;
  /** Persist navigation before changing visible page or running its entry effects. */
  pageChange?: (pageId: string, history: readonly string[], signal: AbortSignal) => Promise<void>;
  /** A script-defined onError/error edge owns the fallback; hosts must not block it. */
  dataSourceErrorHandled?: (id: string) => void;
  dataSource?: (request: DataSourceRequest) => Promise<unknown>;
  command?: (
    action: ExternalAction,
    values: Record<string, JsonValue>,
    signal: AbortSignal,
  ) => Promise<void>;
  toast?: (message: string, tone: string) => void;
  sessionEvent: (event: RuntimeSessionEvent) => void;
  serverValidation?: ServerValidationHook;
  fieldValidation?: FieldValidationHook;
  now?: () => number;
  /** Designer-only, in-memory input recording. Never sent to session telemetry. */
  simulationInput?: (input: PreviewStep) => void;
}
export interface SimulationPorts {
  dataSource?: (request: DataSourceRequest) => Promise<unknown>;
  command?: (
    action: ExternalAction,
    values: Record<string, JsonValue>,
    signal: AbortSignal,
  ) => Promise<void>;
}
