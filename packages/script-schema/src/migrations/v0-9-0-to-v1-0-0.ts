import type { Migration, RawDocument } from './types.js';

const isRecord = (value: unknown): value is RawDocument =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Maps array items; anything else passes through untouched (the schema reports it later). */
const mapArray = (value: unknown, fn: (item: unknown) => unknown): unknown =>
  Array.isArray(value) ? (value as unknown[]).map(fn) : value;

/** Draft action names (SCRIPT_MODEL draft v1) → v1 names (ADR-0010). */
const ACTION_RENAMES: Readonly<Record<string, string>> = {
  openDialog: 'openModal',
  closeDialog: 'closeModal',
  notify: 'showToast',
  runFlow: 'runSubflow',
};

/** Fields that hold nested action lists. */
const NESTED_ACTION_FIELDS = [
  'onSuccess',
  'onError',
  'onInvalid',
  'then',
  'else',
  'actions',
] as const;

function migrateAction(action: unknown): unknown {
  if (!isRecord(action)) return action;
  const { action: draftType, ...rest } = action;
  const migrated: RawDocument =
    typeof draftType === 'string' && !('type' in action)
      ? { type: ACTION_RENAMES[draftType] ?? draftType, ...rest }
      : { ...action };
  for (const field of NESTED_ACTION_FIELDS) {
    if (field in migrated) migrated[field] = mapArray(migrated[field], migrateAction);
  }
  return migrated;
}

const migrateActions = (value: unknown): unknown => mapArray(value, migrateAction);

function migrateNode(node: unknown): unknown {
  if (!isRecord(node)) return node;
  const migrated: RawDocument = { ...node };
  const events = node['events'];
  if (isRecord(events)) {
    migrated['events'] = Object.fromEntries(
      Object.entries(events).map(([event, list]) => [event, migrateActions(list)]),
    );
  }
  if ('children' in node) migrated['children'] = mapArray(node['children'], migrateNode);
  return migrated;
}

function migratePage(page: unknown): unknown {
  if (!isRecord(page)) return page;
  const migrated: RawDocument = { ...page, layout: migrateNode(page['layout']) };
  for (const field of ['onEnter', 'onLeave'] as const) {
    if (field in page) migrated[field] = migrateActions(page[field]);
  }
  if ('timers' in page) {
    migrated['timers'] = mapArray(page['timers'], (timer) =>
      isRecord(timer) ? { ...timer, onElapsed: migrateActions(timer['onElapsed']) } : timer,
    );
  }
  return migrated;
}

function migrateRule(rule: unknown): unknown {
  if (!isRecord(rule)) return rule;
  const migrated: RawDocument = { ...rule };
  for (const field of ['then', 'else'] as const) {
    if (field in rule) migrated[field] = migrateActions(rule[field]);
  }
  return migrated;
}

/**
 * 0.9.0 is the SCRIPT_MODEL draft-v1 shape used before ADR-0010:
 * - `i18n` was `{ [locale]: messages }` with `meta.defaultLocale` / `meta.locales`;
 * - variable scope `screen` is now `page`;
 * - actions were discriminated by `action` (now `type`) and four were renamed.
 */
export const v0_9_0_to_v1_0_0: Migration = {
  from: '0.9.0',
  to: '1.0.0',
  description:
    'Draft model → v1: i18n {defaultLocale, messages}, scope screen→page, action.type + renames',
  up(doc) {
    const meta = isRecord(doc['meta']) ? { ...doc['meta'] } : {};
    const defaultLocale = typeof meta['defaultLocale'] === 'string' ? meta['defaultLocale'] : 'tr';
    delete meta['defaultLocale'];
    delete meta['locales'];

    const draftI18n = isRecord(doc['i18n']) ? doc['i18n'] : {};
    const i18n = 'messages' in draftI18n ? draftI18n : { defaultLocale, messages: draftI18n };

    const migrated: RawDocument = { ...doc, meta, i18n };
    if ('variables' in doc) {
      migrated['variables'] = mapArray(doc['variables'], (variable) =>
        isRecord(variable) && variable['scope'] === 'screen'
          ? { ...variable, scope: 'page' }
          : variable,
      );
    }
    if ('pages' in doc) migrated['pages'] = mapArray(doc['pages'], migratePage);
    if ('rules' in doc) migrated['rules'] = mapArray(doc['rules'], migrateRule);
    return migrated;
  },
};
