import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Textarea, Alert } from '@verbis/ui';

export function JsonField({
  label,
  value,
  change,
}: {
  label: string;
  value: unknown;
  change: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const encoded = JSON.stringify(value === undefined ? null : value, null, 2);
  const previous = useRef(encoded);
  const [source, setSource] = useState(encoded),
    [error, setError] = useState(false);
  useEffect(() => {
    if (previous.current !== encoded) {
      previous.current = encoded;
      setSource(encoded);
      setError(false);
    }
  }, [encoded]);
  return (
    <div data-json-invalid={error ? 'true' : 'false'}>
      <Textarea
        label={label}
        value={source}
        onChange={(e) => {
          const next = e.target.value;
          setSource(next);
          try {
            const parsed: unknown = JSON.parse(next);
            change(parsed);
            previous.current = JSON.stringify(parsed, null, 2);
            setError(false);
          } catch {
            setError(true);
          }
        }}
      />
      {error && <Alert title={t('designer.integrations.invalidJson')} tone="danger" />}
    </div>
  );
}
