import {
  createCoreRegistry,
  type ComponentRegistry as CoreRegistry,
  type ComponentDefinition as CoreDefinition,
  type CorePrimitiveType,
  type DesignerProperty,
} from '@verbis/core-runtime';
import { isEmail, isPhoneTR, isTCKN, isVKN, isIBAN, luhn } from '@verbis/expr';

import { ActionComponent } from './actions.js';
import { DataComponent } from './data.js';
import { InputComponent, SecureInput } from './inputs.js';
import { LayoutComponent } from './layout.js';
import { MediaComponent, Signature } from './media.js';
import { PrivacyComponent, PrivacySchema } from './privacy.js';
import {
  InputSchema,
  SecureInputSchema,
  TextSchema,
  LayoutSchema,
  DataSchema,
  ActionPropsSchema,
  MediaSchema,
} from './schemas.js';
import { ScriptContent, templateDependencies } from './script-text.js';

import type { z } from 'zod';

export interface LibraryDefinition extends CoreDefinition {
  builtOn: readonly CorePrimitiveType[];
  displayName: string;
}
const categories = {
  script: [
    'scriptText',
    'privacyNotice',
    'explicitConsent',
    'callout',
    'objectionHandler',
    'checklist',
    'knowledgeLink',
    'text',
    'heading',
    'richContent',
    'alert',
  ],
  input: [
    'textInput',
    'textArea',
    'numberInput',
    'currencyInput',
    'select',
    'multiSelect',
    'radioGroup',
    'checkboxGroup',
    'checkbox',
    'toggle',
    'datePicker',
    'timePicker',
    'rating',
    'slider',
    'phoneInput',
    'emailInput',
    'maskedInput',
    'addressInput',
    'tcknInput',
    'vknInput',
    'ibanInput',
    'creditCardInput',
  ],
  structure: [
    'section',
    'card',
    'columns',
    'tabs',
    'accordion',
    'stepper',
    'wizard',
    'modal',
    'divider',
    'spacer',
    'repeater',
  ],
  data: [
    'lookup',
    'autoComplete',
    'dataGrid',
    'keyValueList',
    'customerCard',
    'timeline',
    'chart',
    'table',
  ],
  action: [
    'actionButton',
    'nextButton',
    'backButton',
    'buttonGroup',
    'dispositionPicker',
    'outcomeSubmit',
    'transferHint',
    'callbackScheduler',
  ],
  media: [
    'image',
    'video',
    'iframe',
    'timer',
    'countdown',
    'note',
    'badge',
    'progressIndicator',
    'signature',
  ],
} as const;
export const COMPONENT_CATEGORIES = categories;
const secureTypes = ['tcknInput', 'vknInput', 'ibanInput', 'creditCardInput'];
const inputChecks: Record<string, (value: string) => boolean> = {
  emailInput: isEmail,
  phoneInput: isPhoneTR,
  tcknInput: isTCKN,
  vknInput: isVKN,
  ibanInput: isIBAN,
  creditCardInput: (value) =>
    /^\d{13,19}$/.test(value.replace(/ /g, '')) && luhn(value.replace(/ /g, '')),
};
const propertyChoices: Record<string, readonly string[]> = {
  country: ['TR', 'international'],
  currency: ['TRY', 'USD', 'EUR', 'GBP'],
  emphasis: ['normal', 'strong', 'muted'],
  tone: ['neutral', 'info', 'success', 'warning', 'danger'],
  gap: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'],
  orientation: ['horizontal', 'vertical'],
  trigger: ['onLoad', 'manual', 'onEvent', 'onChange'],
  chartType: ['bar', 'line'],
};
function properties(schema: z.ZodObject, bindable: readonly string[]): DesignerProperty[] {
  return Object.keys(schema.shape).map((key) => ({
    key,
    labelKey: `components.properties.${key}`,
    ...(propertyChoices[key] ? { options: propertyChoices[key] } : {}),
    control:
      key === 'columns' && Object.hasOwn(schema.shape, 'rowKey')
        ? 'json'
        : propertyChoices[key]
          ? 'select'
          : key.endsWith('Key') && !['rowKey', 'itemKey', 'iconKey'].includes(key)
            ? 'i18nKey'
            : [
                  'disabled',
                  'required',
                  'loading',
                  'secure',
                  'mustRead',
                  'acknowledged',
                  'open',
                ].includes(key)
              ? 'boolean'
              : [
                    'min',
                    'max',
                    'step',
                    'columns',
                    'durationSec',
                    'debounceMs',
                    'maxLength',
                    'limit',
                  ].includes(key)
                ? 'number'
                : ['params', 'options', 'items', 'blocks', 'validation', 'rows'].includes(key)
                  ? 'json'
                  : key === 'url' || key.endsWith('Url')
                    ? 'asset'
                    : key === 'arrayVariable' || key === 'queryVariable'
                      ? 'variable'
                      : 'text',
    bindable: bindable.includes(key),
    sensitive: key === 'secure',
  }));
}
export const LIBRARY_DEFINITIONS: readonly LibraryDefinition[] = Object.entries(categories).flatMap(
  ([category, types]) =>
    types.map((type) => {
      const secure = secureTypes.includes(type),
        container = category === 'structure' && !['divider', 'spacer'].includes(type);
      const schema = ['privacyNotice', 'explicitConsent'].includes(type)
        ? PrivacySchema
        : category === 'input'
          ? secure
            ? SecureInputSchema
            : InputSchema
          : category === 'script'
            ? TextSchema
            : category === 'structure'
              ? LayoutSchema
              : category === 'data'
                ? DataSchema
                : category === 'action'
                  ? ActionPropsSchema
                  : type === 'note'
                    ? InputSchema
                    : MediaSchema;
      const bindable = Object.keys(schema.shape).filter(
        (key) =>
          ![
            'url',
            'poster',
            'captionsUrl',
            ...(category === 'input' ? [] : ['options']),
            'items',
            'blocks',
            'validation',
            'secure',
          ].includes(key),
      );
      const renderer = ['privacyNotice', 'explicitConsent'].includes(type)
        ? PrivacyComponent
        : category === 'input'
          ? secure
            ? SecureInput
            : InputComponent
          : category === 'script'
            ? ScriptContent
            : category === 'structure'
              ? LayoutComponent
              : category === 'data'
                ? DataComponent
                : category === 'action'
                  ? ActionComponent
                  : type === 'signature'
                    ? Signature
                    : type === 'note'
                      ? InputComponent
                      : MediaComponent;
      const builtOn: readonly CorePrimitiveType[] =
        category === 'data'
          ? ['box', 'webService', 'button']
          : category === 'action'
            ? ['box', 'button']
            : [
                'box',
                ...(category === 'script' && ['objectionHandler', 'knowledgeLink'].includes(type)
                  ? ['button' as const]
                  : []),
              ];
      const definition: LibraryDefinition = {
        type,
        displayName: type.charAt(0).toUpperCase() + type.slice(1),
        renderer,
        propsSchema: schema,
        defaults:
          type === 'explicitConsent' ? { labelKey: 'components.consentLabel', value: false } : {},
        builtOn,
        designerMeta: {
          icon:
            category === 'input'
              ? 'TextCursorInput'
              : category === 'data'
                ? 'Database'
                : category === 'action'
                  ? 'MousePointer2'
                  : category === 'media'
                    ? 'Image'
                    : category === 'structure'
                      ? 'PanelsTopLeft'
                      : 'FileText',
          category,
          acceptsChildren: container ? '*' : [],
          allowedParents: '*',
          draggable: true,
          properties: properties(schema, bindable).map((property) => ({
            ...property,
            sensitive: (secure && property.key === 'value') || property.sensitive === true,
          })),
        },
        events: [
          'onPress',
          'onChange',
          'onBlur',
          'onRead',
          'onSuccess',
          'onError',
          'onElapsed',
          'onClear',
        ],
        bindableProps: bindable,
        ...(secure ? { secureBindings: ['value'] } : {}),
        ...(type === 'repeater' ? { ownsChildren: true } : {}),
        dependencies: (node, document) =>
          category === 'data'
            ? [`ds.${typeof node.props['ds'] === 'string' ? node.props['ds'] : 'lookup'}`]
            : type === 'repeater'
              ? [
                  `vars.${typeof node.props['arrayVariable'] === 'string' ? node.props['arrayVariable'] : 'items'}`,
                ]
              : category === 'script'
                ? [
                    `runtime.read.${node.id}`,
                    ...Object.values(document.i18n.messages).flatMap((messages) =>
                      [
                        typeof node.props['textKey'] === 'string'
                          ? node.props['textKey']
                          : 'components.sample.script',
                        ...(Array.isArray(node.props['blocks'])
                          ? node.props['blocks'].flatMap((block) =>
                              block !== null &&
                              typeof block === 'object' &&
                              !Array.isArray(block) &&
                              typeof block['textKey'] === 'string'
                                ? [block['textKey']]
                                : [],
                            )
                          : []),
                      ].flatMap((key) => templateDependencies(messages[key] ?? '')),
                    ),
                  ]
                : [],
        validate: (node, store) => {
          if (node.props['mustRead'] === true) {
            const binding = node.bindings.find((b) => b.prop === 'acknowledged' && 'variable' in b);
            if (
              store.get(`runtime.read.${node.id}`) !== true &&
              node.props['acknowledged'] !== true &&
              !(binding && 'variable' in binding && store.variable(binding.variable) === true)
            )
              return [{ messageKey: 'components.mustRead' }];
          }
          const check =
              type === 'phoneInput' && node.props['country'] === 'international'
                ? (value: string) => /^\+[1-9]\d{6,14}$/.test(value.replace(/[ ()-]/g, ''))
                : inputChecks[type],
            binding = node.bindings.find((b) => b.prop === 'value' && 'variable' in b);
          const value =
            binding && 'variable' in binding
              ? store.variable(binding.variable)
              : node.props['value'];
          if (
            !secure &&
            node.props['secure'] !== true &&
            check &&
            typeof value === 'string' &&
            value !== '' &&
            !check(value)
          )
            return [{ messageKey: 'components.invalid' }];
          return [];
        },
      };
      return definition;
    }),
);
export function registerBuiltins(registry: CoreRegistry): CoreRegistry {
  for (const definition of LIBRARY_DEFINITIONS) registry.register(definition);
  return registry;
}
export function createComponentRegistry(): CoreRegistry {
  return registerBuiltins(createCoreRegistry());
}
