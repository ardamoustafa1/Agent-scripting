import { useState, useEffect, useRef } from 'react';
import { z } from 'zod';

import type { RendererProps } from '@verbis/core-runtime';
import { isEmail, isPhoneTR, isTCKN, isVKN, isIBAN, luhn } from '@verbis/expr';
import { type JsonValue, JsonValueSchema } from '@verbis/script-schema';
import {
  Input,
  Textarea,
  Select,
  MultiSelect,
  Radio,
  Checkbox,
  Switch,
  Slider,
  DatePicker,
  TimePicker,
  Alert,
} from '@verbis/ui';

import { safeAssetUrl, useComponentEnvironment } from './environment.js';
import { InputSchema, SecureInputSchema } from './schemas.js';
import { Frame, useField, useLabels } from './shared.js';

export function formatMask(value: string, mask: string): string {
  const digits = value.replace(/\D/g, '');
  let index = 0,
    result = '';
  for (const char of mask) {
    if (index >= digits.length) break;
    result += char === '#' ? (digits[index++] ?? '') : char;
  }
  return result;
}
const validators: Record<string, (value: string) => boolean> = {
  emailInput: isEmail,
  phoneInput: isPhoneTR,
  tcknInput: isTCKN,
  vknInput: isVKN,
  ibanInput: isIBAN,
  creditCardInput: (value) =>
    /^\d{13,19}$/.test(value.replace(/ /g, '')) && luhn(value.replace(/ /g, '')),
};
export function InputComponent(component: RendererProps) {
  return component.props['secure'] === true ? (
    <SecureInput {...component} />
  ) : (
    <PlainInput {...component} />
  );
}
function PlainInput(component: RendererProps) {
  const p = InputSchema.parse(component.props),
    f = useField(component),
    { text, t } = useLabels(component);
  const [invalid, setInvalid] = useState(false);
  const options = p.options.map((option) => ({
    value: option.value,
    label: text(option.labelKey),
    disabled: option.disabled,
  }));
  const string =
    typeof f.value === 'string' ? f.value : typeof f.value === 'number' ? String(f.value) : '';
  const common = {
    id: `${component.node.id}-input`,
    label: f.label,
    disabled: f.disabled,
    required: f.required,
    ...(f.error ? { error: f.error } : invalid ? { error: t('components.invalid') } : {}),
    ...(f.hint ? { hint: f.hint } : {}),
    'aria-describedby': f['aria-describedby'],
  };
  let field;
  switch (component.node.type) {
    case 'textArea':
    case 'note':
      field = (
        <Textarea
          {...common}
          value={string}
          maxLength={p.maxLength}
          onChange={(event) => {
            f.write(event.target.value);
          }}
        />
      );
      break;
    case 'numberInput':
    case 'currencyInput':
      field = (
        <Input
          {...common}
          type="number"
          value={string}
          min={p.min}
          max={p.max}
          step={component.node.type === 'currencyInput' ? 0.01 : p.step}
          inputMode="decimal"
          onChange={(event) => {
            const value = event.target.value;
            if (value === '') f.write(null);
            else if (Number.isFinite(Number(value))) f.write(Number(value));
          }}
          {...(component.node.type === 'currencyInput' ? { hint: p.currency } : {})}
        />
      );
      break;
    case 'select':
      field = (
        <Select
          label={f.label}
          disabled={f.disabled}
          options={options}
          value={string}
          onValueChange={(value) => {
            f.write(value);
          }}
        />
      );
      break;
    case 'multiSelect':
      field = (
        <MultiSelect
          label={f.label}
          disabled={f.disabled}
          options={options}
          value={
            Array.isArray(f.value) ? f.value.filter((v): v is string => typeof v === 'string') : []
          }
          onValueChange={(value) => {
            f.write(value);
          }}
        />
      );
      break;
    case 'radioGroup':
      field = (
        <Radio
          label={f.label}
          disabled={f.disabled}
          options={options}
          value={string}
          onValueChange={(value) => {
            f.write(value);
          }}
        />
      );
      break;
    case 'checkboxGroup': {
      const values = Array.isArray(f.value)
        ? f.value.filter((v): v is string => typeof v === 'string')
        : [];
      field = (
        <fieldset disabled={f.disabled}>
          <legend>{f.label}</legend>
          {options.map((option) => (
            <Checkbox
              key={option.value}
              label={option.label}
              checked={values.includes(option.value)}
              disabled={f.disabled || option.disabled}
              onCheckedChange={(checked) => {
                f.write(
                  checked
                    ? [...new Set([...values, option.value])]
                    : values.filter((v) => v !== option.value),
                );
              }}
            />
          ))}
        </fieldset>
      );
      break;
    }
    case 'checkbox':
      field = (
        <Checkbox
          label={f.label}
          checked={f.value === true || component.props['checked'] === true}
          disabled={f.disabled}
          onCheckedChange={(checked) => {
            f.write(
              checked === true,
              component.node.bindings.some((b) => b.prop === 'checked') ? 'checked' : 'value',
            );
          }}
        />
      );
      break;
    case 'toggle':
      field = (
        <Switch
          label={f.label}
          checked={f.value === true || component.props['checked'] === true}
          disabled={f.disabled}
          onCheckedChange={(value) => {
            f.write(
              value,
              component.node.bindings.some((b) => b.prop === 'checked') ? 'checked' : 'value',
            );
          }}
        />
      );
      break;
    case 'rating':
      field = (
        <Radio
          label={f.label}
          disabled={f.disabled}
          options={Array.from(
            { length: Math.max(1, Math.min(10, Math.floor(p.max ?? 5))) },
            (_, i) => ({
              value: String(i + 1),
              label: t('components.stars', { count: i + 1 }),
            }),
          )}
          value={string}
          onValueChange={(value) => {
            f.write(Number(value));
          }}
        />
      );
      break;
    case 'slider':
      field = (
        <Slider
          label={f.label}
          disabled={f.disabled}
          min={p.min ?? 0}
          max={p.max ?? 100}
          step={p.step}
          value={[typeof f.value === 'number' ? f.value : 0]}
          onValueChange={(value) => {
            f.write(value[0] ?? 0);
          }}
        />
      );
      break;
    case 'datePicker': {
      const date = string ? new Date(`${string.slice(0, 10)}T12:00:00`) : undefined;
      field = (
        <DatePicker
          label={f.label}
          disabled={f.disabled}
          {...(date && Number.isFinite(date.getTime()) ? { value: date } : {})}
          onValueChange={(value) => {
            f.write(
              value
                ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
                : '',
            );
          }}
        />
      );
      break;
    }
    case 'timePicker':
      field = (
        <TimePicker
          {...common}
          value={string}
          onChange={(event) => {
            f.write(event.target.value);
          }}
        />
      );
      break;
    case 'addressInput': {
      const address: Record<string, JsonValue> =
        f.value !== null && typeof f.value === 'object' && !Array.isArray(f.value)
          ? z.record(z.string(), JsonValueSchema).parse(f.value)
          : {};
      field = (
        <fieldset disabled={f.disabled}>
          <legend>{f.label}</legend>
          {['line', 'city', 'district', 'postalCode', 'country'].map((key) => (
            <Input
              key={key}
              id={`${component.node.id}-${key}`}
              label={t(`components.address.${key}`)}
              value={typeof address[key] === 'string' ? address[key] : ''}
              autoComplete={
                key === 'line'
                  ? 'street-address'
                  : key === 'postalCode'
                    ? 'postal-code'
                    : key === 'country'
                      ? 'country-name'
                      : 'address-level2'
              }
              maxLength={512}
              onChange={(event) => {
                f.write({ ...address, [key]: event.target.value });
              }}
            />
          ))}
        </fieldset>
      );
      break;
    }
    default: {
      const validator = validators[component.node.type];
      field = (
        <Input
          {...common}
          type={
            p.secure
              ? 'password'
              : component.node.type === 'emailInput'
                ? 'email'
                : component.node.type === 'phoneInput'
                  ? 'tel'
                  : 'text'
          }
          inputMode={component.node.type === 'phoneInput' || p.mask ? 'tel' : 'text'}
          autoComplete={
            p.secure
              ? 'off'
              : component.node.type === 'emailInput'
                ? 'email'
                : component.node.type === 'phoneInput'
                  ? 'tel'
                  : 'off'
          }
          maxLength={p.maxLength}
          value={p.mask ? formatMask(string, p.mask) : string}
          {...(p.placeholderKey ? { placeholder: text(p.placeholderKey) } : {})}
          onChange={(event) => {
            setInvalid(false);
            f.write(p.mask ? event.target.value.replace(/\D/g, '') : event.target.value);
          }}
          onBlur={() => {
            setInvalid(
              string !== '' &&
                validator !== undefined &&
                !(component.node.type === 'phoneInput' && p.country === 'international'
                  ? /^\+[1-9]\d{6,14}$/.test(string)
                  : validator(string)),
            );
            void component.emit('onBlur').catch(() => undefined);
          }}
        />
      );
    }
  }
  return (
    <Frame component={component}>
      {field}
      {invalid && component.node.type !== 'textInput' && (
        <Alert tone="danger" title={t('components.invalid')} />
      )}
    </Frame>
  );
}
/** Hosted capture: PAN/CVV and other secure values never enter Verbis DOM or state. */
export function SecureInput(component: RendererProps) {
  SecureInputSchema.parse(component.props);
  const f = useField(component),
    { t } = useLabels(component),
    environment = useComponentEnvironment();
  const latest = useRef(component);
  useEffect(() => {
    latest.current = component;
  }, [component]);
  const provider = environment.secureCapture,
    frame = useRef<HTMLIFrameElement>(null);
  const [challenge] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const binding = component.node.bindings.find(
    (entry) => entry.prop === 'value' && 'variable' in entry,
  );
  const variable = binding && 'variable' in binding ? binding.variable : undefined;
  useEffect(() => {
    if (!provider || !variable || f.disabled) return;
    const controller = new AbortController();
    let received = false;
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== provider.origin ||
        event.source !== frame.current?.contentWindow ||
        received
      )
        return;
      const parsed = z
        .strictObject({
          type: z.literal('verbis.secure.receipt'),
          challenge: z.literal(challenge),
          sessionId: z.literal(provider.sessionId),
          variable: z.literal(variable),
          receipt: z
            .string()
            .min(16)
            .max(8192)
            .regex(
              /^(?:tok_[A-Za-z0-9_-]{16,512}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/,
            ),
        })
        .safeParse(event.data);
      if (!parsed.success) return;
      received = true;
      void provider
        .confirmReceipt(variable, parsed.data.receipt, controller.signal)
        .then(() => {
          if (!controller.signal.aborted) {
            // A non-sensitive marker satisfies local required validation; the actual token stays server-side.
            if (latest.current.runtime.store.classification(variable) === 'pci')
              latest.current.write('value', '[TOKENIZED]');
            setStatus('saved');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus('failed');
        });
    };
    window.addEventListener('message', receive);
    return () => {
      controller.abort();
      window.removeEventListener('message', receive);
    };
  }, [provider, variable, challenge, f.disabled]);
  if (!provider || !variable || f.disabled)
    return (
      <Frame component={component}>
        <Alert title={t('components.secureUnavailable')} />
      </Frame>
    );
  const url = new URL(safeAssetUrl(provider.url, [provider.origin]));
  if (url.origin === window.location.origin)
    throw new Error('Secure capture must use a separate origin');
  url.searchParams.set('sessionId', provider.sessionId);
  url.searchParams.set('variable', variable);
  url.searchParams.set('challenge', challenge);
  return (
    <Frame component={component}>
      <iframe
        ref={frame}
        title={f.label}
        src={url.href}
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'"
      />
      <span role="status">
        {t(
          status === 'saved'
            ? 'components.secureSaved'
            : status === 'failed'
              ? 'components.secureFailed'
              : 'components.secureHint',
        )}
      </span>
    </Frame>
  );
}
