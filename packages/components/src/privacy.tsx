import { z } from 'zod';

import type { RendererProps } from '@verbis/core-runtime';
import { I18nKeySchema } from '@verbis/script-schema';
import { Alert, Checkbox } from '@verbis/ui';

import { Frame, useField, useLabels } from './shared.js';

export const PrivacySchema = z.strictObject({
  labelKey: I18nKeySchema.default('components.privacyTitle'),
  titleKey: I18nKeySchema.optional(),
  descriptionKey: I18nKeySchema.optional(),
  textKey: I18nKeySchema.default('components.privacyPlaceholder'),
  purposeKey: I18nKeySchema.default('components.consentPurpose'),
  noticeVersion: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .default('1'),
  disabled: z.boolean().default(false),
  value: z.boolean().default(false),
});
/** Notification and optional consent stay separate; consent is never preselected. */
export function PrivacyComponent(component: RendererProps) {
  const p = PrivacySchema.parse(component.props),
    { text, t } = useLabels(component),
    f = useField(component);
  if (component.node.type === 'privacyNotice')
    return (
      <Frame component={component}>
        <Alert title={text(p.labelKey)}>{text(p.textKey)}</Alert>
        <small>{t('components.noticeVersion', { version: p.noticeVersion })}</small>
      </Frame>
    );
  return (
    <Frame component={component}>
      <p>{text(p.purposeKey)}</p>
      <Checkbox
        label={text(p.labelKey, 'components.consentLabel')}
        checked={
          component.node.bindings.some((b) => b.prop === 'value' && 'variable' in b) &&
          f.value === true
        }
        disabled={f.disabled}
        onCheckedChange={(checked) => {
          f.write(checked === true);
        }}
      />
      <small>{t('components.consentOptional')}</small>
    </Frame>
  );
}
