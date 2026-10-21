import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Select, Textarea } from '@verbis/ui';

import { insertToken } from './text-variables.js';

/**
 * Script text with an "insert variable" picker. The token lands at the caret as `{name}`; the
 * caller keeps the params plumbing in sync, so authors never write bindings by hand.
 */
export function VariableTextField({
  label,
  value,
  onChange,
  variables,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  variables: readonly string[];
  rows?: number;
}) {
  const { t } = useTranslation();
  const field = useRef<HTMLTextAreaElement>(null);
  // Remounting resets the picker to its placeholder after each insertion.
  const [picker, setPicker] = useState(0);
  return (
    <div className="ed-variable-text">
      <Textarea
        ref={field}
        label={label}
        value={value}
        {...(rows === undefined ? {} : { rows })}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {variables.length > 0 && (
        <Select
          key={picker}
          label={t('designer.textVariables.insert', { field: label })}
          placeholder={t('designer.textVariables.placeholder')}
          value=""
          options={variables.map((key) => ({ value: key, label: `{${key}}` }))}
          onValueChange={(key) => {
            const element = field.current;
            const next = insertToken(
              value,
              key,
              element?.selectionStart ?? value.length,
              element?.selectionEnd ?? value.length,
            );
            onChange(next.text);
            setPicker((n) => n + 1);
            requestAnimationFrame(() => {
              element?.focus();
              element?.setSelectionRange(next.caret, next.caret);
            });
          }}
        />
      )}
    </div>
  );
}
