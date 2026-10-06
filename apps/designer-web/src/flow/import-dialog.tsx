import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Dialog, Input, Alert, Select } from '@verbis/ui';

import { request } from '../api/client.js';
import { EditorDocumentSchema, useEditor, type EditorStore } from '../editor/store.js';

import { importSubflow } from './import.js';
import { createScreenSubflow } from './model.js';

export function SubflowImport({
  store,
  disabled,
  onImported,
}: {
  store: EditorStore;
  disabled: boolean;
  onImported: (id: string) => void;
}) {
  const { t } = useTranslation();
  const state = useEditor(store);
  const [screen, setScreen] = useState(state.document.pages[0]?.id ?? '');
  const [open, setOpen] = useState(false),
    [script, setScript] = useState(''),
    [version, setVersion] = useState(1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false);
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('designer.flow.import')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!loading) setOpen(value);
        }}
        title={t('designer.flow.import')}
        description={t('designer.flow.importHelp')}
      >
        <Input
          label={t('designer.flow.sourceScript')}
          value={script}
          onChange={(e) => {
            setScript(e.target.value);
          }}
        />
        <Input
          label={t('designer.flow.sourceVersion')}
          type="number"
          min={1}
          value={version}
          onChange={(e) => {
            setVersion(Number(e.target.value));
          }}
        />
        <Select
          label={t('designer.flow.screenFragment')}
          value={screen}
          options={state.document.pages.map((p) => ({ value: p.id, label: p.name }))}
          onValueChange={setScreen}
        />
        <Button
          disabled={disabled || loading || !screen}
          onClick={() => {
            if (disabled) return;
            store.execute(() => {
              const id = `subflow-${crypto.randomUUID()}`;
              createScreenSubflow(store, screen, id);
              onImported(id);
              setOpen(false);
            });
          }}
        >
          {t('designer.flow.reuseScreen')}
        </Button>
        <p>{t('designer.flow.importHelp')}</p>
        {error && <Alert tone="danger" title={t('designer.flow.importFailed')} />}
        <Button
          loading={loading}
          disabled={
            disabled ||
            !z.uuid().safeParse(script).success ||
            !Number.isSafeInteger(version) ||
            version < 1
          }
          onClick={() => {
            setLoading(true);
            setError(false);
            void request(`/v1/scripts/${script}/versions/${version}`, EditorDocumentSchema)
              .then((source) => {
                if (disabled) return;
                const id = importSubflow(store, source.document);
                onImported(id);
                setOpen(false);
              })
              .catch(() => {
                setError(true);
              })
              .finally(() => {
                setLoading(false);
              });
          }}
        >
          {t('designer.editor.apply')}
        </Button>
      </Dialog>
    </>
  );
}
