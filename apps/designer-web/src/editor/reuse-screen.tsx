import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Dialog, Select, Alert } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const Screens = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    latest: z.object({ number: z.number().int() }).nullable(),
  }),
);
export function ReuseScreen({
  used,
  attach,
}: {
  used: readonly string[];
  attach: (id: string, number: number) => Promise<void>;
}) {
  const { t } = useTranslation(),
    { session, environment } = useWorkspace();
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const list = useQuery({
    queryKey: [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      environment,
      'shared-screen-picker',
    ],
    enabled: open,
    queryFn: ({ signal }) => request('/v1/shared-screens', Screens, { signal }),
  });
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('designer.editor.reuse')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title={t('designer.editor.reuse')}
        description={t('designer.editor.reuseDescription')}
      >
        <Select
          label={t('designer.editor.linked')}
          value={selected}
          options={(list.data ?? [])
            .filter((s) => !used.includes(s.id) && s.latest)
            .map((s) => ({ value: s.id, label: s.name }))}
          onValueChange={setSelected}
        />
        {(list.isError || error) && (
          <Alert tone="danger" title={t('designer.editor.operationFailed')} />
        )}
        <Button
          loading={busy}
          disabled={!selected}
          onClick={() => {
            const screen = list.data?.find((s) => s.id === selected);
            if (!screen?.latest) return;
            setBusy(true);
            setError(false);
            void attach(screen.id, screen.latest.number)
              .then(() => {
                setOpen(false);
              })
              .catch(() => {
                setError(true);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {t('designer.editor.attach')}
        </Button>
      </Dialog>
    </>
  );
}
