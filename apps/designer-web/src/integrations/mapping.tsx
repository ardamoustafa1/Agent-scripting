import {
  DndContext,
  useDraggable,
  useDroppable,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Select, Input, Textarea, Alert } from '@verbis/ui';

import { fields, projection, projectionFields } from './importers.js';

function Source({ path }: { path: string }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id: path });
  return (
    <Button ref={setNodeRef} {...attributes} {...listeners} variant="ghost">
      {path}
    </Button>
  );
}
function Target({ field, path }: { field: string; path: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `target:${field}` });
  return (
    <div ref={setNodeRef} className={isOver ? 'ig-drop ig-drop-active' : 'ig-drop'}>
      <strong>{field}</strong>
      <code>{path}</code>
    </div>
  );
}
export function MappingEditor({
  sample,
  value,
  onChange,
}: {
  sample: unknown;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const mapping = useMemo(() => projectionFields(value), [value]);
  const [target, setTarget] = useState('result'),
    [path, setPath] = useState(''),
    [error, setError] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const assign = (field: string, source: string) => {
    if (mapping === null) return;
    try {
      const next = { ...mapping, [field]: source };
      const expression = projection(next);
      onChange(expression);
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        if (over?.id.toString().startsWith('target:'))
          assign(over.id.toString().slice(7), active.id.toString());
      }}
    >
      <div className="ig-mapping">
        <section aria-label={t('designer.integrations.sourceFields')}>
          <h2>{t('designer.integrations.sourceFields')}</h2>
          {fields(sample).length === 0 && <p>{t('designer.integrations.noSourceFields')}</p>}
          {fields(sample).map((field) => (
            <Source key={field} path={field} />
          ))}
        </section>
        <section aria-label={t('designer.integrations.targetFields')}>
          <h2>{t('designer.integrations.targetFields')}</h2>
          {mapping === null ? (
            <p>{t('designer.integrations.manualMappingHelp')}</p>
          ) : (
            Object.keys(mapping).length === 0 && <p>{t('designer.integrations.noTargetFields')}</p>
          )}
          {Object.entries(mapping ?? {}).map(([field, path]) => (
            <Target key={field} field={field} path={path} />
          ))}
        </section>
      </div>
      <Input
        label={t('designer.integrations.targetField')}
        value={target}
        onChange={(e) => {
          setTarget(e.target.value);
        }}
      />
      <Select
        label={t('designer.integrations.sourceField')}
        value={path}
        options={fields(sample).map((value) => ({ value, label: value }))}
        onValueChange={setPath}
      />
      <Button
        disabled={!path || !target || mapping === null}
        onClick={() => {
          assign(target, path);
        }}
      >
        {t('designer.integrations.mapField')}
      </Button>
      {error && <Alert title={t('designer.integrations.invalidMapping')} tone="danger" />}
      <Textarea
        label={t('designer.integrations.jsonata')}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </DndContext>
  );
}
