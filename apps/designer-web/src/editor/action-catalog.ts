import {
  ACTION_TYPES,
  ActionSchema,
  walkNodes,
  type Action,
  type ActionType,
  type ScriptDocument,
} from '@verbis/script-schema';

import { jsonDefault } from '../flow/variables.js';

/** The order authors see in the action picker; every action type appears exactly once. */
export const ACTION_GROUPS: readonly { id: string; types: readonly ActionType[] }[] = [
  { id: 'navigation', types: ['next', 'back', 'navigate', 'validatePage'] },
  { id: 'data', types: ['setVariable', 'callDataSource'] },
  {
    id: 'outcome',
    types: ['submitOutcome', 'setDisposition', 'writeBackToPlatform', 'transferHint'],
  },
  { id: 'screen', types: ['showToast', 'openModal', 'closeModal', 'maskField'] },
  { id: 'logic', types: ['conditional', 'sequence', 'parallel', 'runSubflow'] },
  { id: 'timer', types: ['startTimer', 'stopTimer'] },
  { id: 'tracking', types: ['logEvent', 'emitEvent'] },
];
export const GROUPED_ACTION_TYPES = ACTION_GROUPS.flatMap((group) => group.types);
if (
  GROUPED_ACTION_TYPES.length !== ACTION_TYPES.length ||
  ACTION_TYPES.some((type) => !GROUPED_ACTION_TYPES.includes(type))
)
  throw new Error('VERBIS_ACTION_GROUPS_INCOMPLETE');

export const TIMER_TYPES = new Set(['timer', 'countdown']);
/** Components whose value an action may mask; same set the inspector treats as inputs. */
export function maskableNodes(document: ScriptDocument, isInput: (type: string) => boolean) {
  const nodes: { id: string; type: string; labelKey: string | undefined }[] = [];
  walkNodes(document, ({ node }) => {
    if (isInput(node.type))
      nodes.push({
        id: node.id,
        type: node.type,
        labelKey: typeof node.props['labelKey'] === 'string' ? node.props['labelKey'] : undefined,
      });
    return true;
  });
  return nodes;
}
export function timerNodes(document: ScriptDocument) {
  const nodes: { id: string; type: string }[] = [];
  walkNodes(document, ({ node }) => {
    if (TIMER_TYPES.has(node.type)) nodes.push({ id: node.id, type: node.type });
    return true;
  });
  return nodes;
}

/** What a new action of a type needs from the document; `null` when the document lacks it. */
export type ActionNeed = 'variable' | 'dataSource' | 'subflow' | 'timer' | 'node' | 'page';
export interface ActionDefaultsContext {
  document: ScriptDocument;
  /** Fresh i18n key for a new message (`showToast`). */
  messageKey: () => string;
  isInput: (type: string) => boolean;
  pageId?: string | undefined;
}

/**
 * A valid action of `type` built from the document, so switching type never asks the author
 * for JSON. Returns the missing prerequisite instead when one is required.
 */
export function defaultAction(
  type: ActionType,
  ctx: ActionDefaultsContext,
): { action: Action } | { need: ActionNeed } {
  const { document } = ctx;
  const variable = document.variables.find((v) => v.scope !== 'global');
  const page =
    document.pages.find((p) => p.id !== ctx.pageId)?.id ?? document.pages[0]?.id ?? undefined;
  let draft: unknown;
  switch (type) {
    case 'setVariable':
      if (!variable) return { need: 'variable' };
      draft = {
        type,
        variable: variable.key,
        value:
          variable.type === 'enum'
            ? (variable.enumValues?.[0] ?? '')
            : variable.pii || variable.classification !== 'internal'
              ? ''
              : jsonDefault(variable.type),
      };
      break;
    case 'callDataSource': {
      const source = document.dataSources[0];
      if (!source) return { need: 'dataSource' };
      draft = { type, dataSource: source.id };
      break;
    }
    case 'navigate':
    case 'openModal':
      if (!page) return { need: 'page' };
      draft = { type, page };
      break;
    case 'showToast':
      draft = { type, messageKey: ctx.messageKey(), tone: 'info' };
      break;
    case 'submitOutcome':
      draft = { type, outcome: 'COMPLETED' };
      break;
    case 'setDisposition':
      draft = { type, code: 'COMPLETED' };
      break;
    case 'writeBackToPlatform':
      draft = { type, attributes: {} };
      break;
    case 'transferHint':
      draft = { type, target: 'queue' };
      break;
    case 'runSubflow': {
      const flow = document.subflows[0];
      if (!flow) return { need: 'subflow' };
      draft = { type, flow: flow.id };
      break;
    }
    case 'conditional':
      draft = { type, if: { $expr: 'true' }, then: [], else: [] };
      break;
    case 'sequence':
    case 'parallel':
      draft = { type, actions: [] };
      break;
    case 'emitEvent':
      draft = { type, name: 'script.event' };
      break;
    case 'logEvent':
      draft = { type, event: 'script.note', level: 'info' };
      break;
    case 'startTimer':
    case 'stopTimer': {
      const timer = timerNodes(document)[0];
      if (!timer) return { need: 'timer' };
      draft = { type, timer: timer.id };
      break;
    }
    case 'maskField': {
      const node = maskableNodes(document, ctx.isInput)[0];
      if (!node) return { need: 'node' };
      draft = { type, node: node.id, masked: true };
      break;
    }
    default:
      draft = { type };
  }
  return { action: ActionSchema.parse(draft) };
}

/** One readable line for an action row: "Set variable · trackingNo". */
export function actionDetail(
  action: Action,
  document: ScriptDocument,
  message: (key: string) => string,
): string | undefined {
  switch (action.type) {
    case 'setVariable':
      return action.variable;
    case 'callDataSource':
      return action.dataSource;
    case 'navigate':
    case 'openModal':
      return document.pages.find((p) => p.id === action.page)?.name ?? action.page;
    case 'validatePage':
      return action.page
        ? (document.pages.find((p) => p.id === action.page)?.name ?? action.page)
        : undefined;
    case 'showToast': {
      const text = message(action.messageKey);
      return text ? `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : undefined;
    }
    case 'submitOutcome':
      return action.outcome;
    case 'setDisposition':
      return action.subCode ? `${action.code} / ${action.subCode}` : action.code;
    case 'writeBackToPlatform':
      return Object.keys(action.attributes).join(', ') || undefined;
    case 'transferHint':
      return action.target;
    case 'runSubflow':
      return document.subflows.find((f) => f.id === action.flow)?.name ?? action.flow;
    case 'emitEvent':
      return action.name;
    case 'logEvent':
      return action.event;
    default:
      return undefined;
  }
}
