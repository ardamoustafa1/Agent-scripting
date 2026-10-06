import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import {
  IntegrationAuthSchema,
  IntegrationSecretSetSchema,
  type IntegrationAuth,
} from '@verbis/shared-types';
import { Button, Input, Select, Dialog, Alert } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const Metadata = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: IntegrationSecretSetSchema.shape.kind,
  keyVersion: z.int(),
});
export function AuthEditor({
  value,
  change,
}: {
  value: IntegrationAuth;
  change: (value: IntegrationAuth) => void;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility();
  const [rotate, setRotate] = useState(false),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const secrets = useInfiniteQuery({
    queryKey: ['workspace', session.user.tenantId, session.user.id, session.session.id, 'secrets'],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      request(
        `/v1/secrets?limit=100${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        z.object({
          data: z.array(Metadata),
          page: z.object({ nextCursor: z.string().nullable() }),
        }),
        { signal },
      ),
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled: ability.can('read', 'Secret'),
  });
  const rows = secrets.data?.pages.flatMap((page) => page.data) ?? [];
  const secretRef = 'secretRef' in value ? value.secretRef : '';
  const selected = rows.find((s) => s.id === secretRef);
  const patch = (data: Record<string, unknown>) => {
    const candidate = { ...value, ...data };
    // A URL is incomplete while typing. The parent Save gate validates the actual endpoint.
    const parsed = IntegrationAuthSchema.safeParse(
      'tokenUrl' in value ? { ...candidate, tokenUrl: 'https://placeholder.invalid' } : candidate,
    );
    if (parsed.success) {
      if (
        'tokenUrl' in parsed.data &&
        'tokenUrl' in candidate &&
        typeof candidate.tokenUrl === 'string'
      )
        change({ ...parsed.data, tokenUrl: candidate.tokenUrl });
      else change(parsed.data);
    }
  };
  return (
    <section className="ig-stack">
      <Select
        label={t('designer.integrations.auth')}
        value={value.type}
        options={IntegrationAuthSchema.options.map((schema) => ({
          value: schema.shape.type.value,
          label: schema.shape.type.value,
        }))}
        onValueChange={(type) => {
          const ref = secretRef || rows[0]?.id;
          const parsed = IntegrationAuthSchema.safeParse({
            type,
            ...(type === 'none' ? {} : { secretRef: ref }),
            ...(type === 'apiKey' ? { placement: 'header', name: 'X-API-Key' } : {}),
            ...(type.startsWith('oauth2') ? { tokenUrl: 'https://placeholder.invalid' } : {}),
          });
          if (parsed.success) {
            change('tokenUrl' in parsed.data ? { ...parsed.data, tokenUrl: '' } : parsed.data);
            setError(false);
          } else setError(true);
        }}
      />
      {value.type !== 'none' && (
        <Select
          label={t('designer.integrations.secret')}
          value={secretRef}
          options={rows.map((s) => ({
            value: s.id,
            label: `${s.name} · v${s.keyVersion}`,
          }))}
          onValueChange={(secretRef) => {
            patch({ secretRef });
          }}
        />
      )}
      {value.type === 'apiKey' && (
        <>
          <Input
            label={t('designer.integrations.headerName')}
            value={value.name}
            onChange={(e) => {
              patch({ name: e.target.value });
            }}
          />
          <Select
            label={t('designer.integrations.placement')}
            value={value.placement}
            options={['header', 'query'].map((value) => ({ value, label: value }))}
            onValueChange={(placement) => {
              patch({ placement });
            }}
          />
        </>
      )}
      {'tokenUrl' in value && (
        <>
          <Input
            label={t('designer.integrations.tokenUrl')}
            placeholder="https://auth.example.com/token"
            value={value.tokenUrl}
            onChange={(e) => {
              patch({ tokenUrl: e.target.value });
            }}
          />
          <Input
            label={t('designer.integrations.scope')}
            value={value.scope ?? ''}
            onChange={(e) => {
              patch({ scope: e.target.value });
            }}
          />
        </>
      )}
      {value.type === 'hmac' && (
        <Input
          label={t('designer.integrations.headerName')}
          value={value.header}
          onChange={(e) => {
            patch({ header: e.target.value });
          }}
        />
      )}
      {secrets.hasNextPage && (
        <Button
          loading={secrets.isFetchingNextPage}
          onClick={() => {
            void secrets.fetchNextPage();
          }}
        >
          {t('designer.integrations.more')}
        </Button>
      )}
      <p>{t('designer.integrations.secretHelp')}</p>
      <Button
        disabled={
          secretRef
            ? !ability.can('update', 'Secret') || !selected
            : !ability.can('create', 'Secret')
        }
        variant="ghost"
        onClick={() => {
          setName(selected?.name ?? '');
          setPassword('');
          setError(false);
          setRotate(true);
        }}
      >
        {t(secretRef ? 'designer.integrations.rotate' : 'designer.integrations.newSecret')}
      </Button>
      {error && <Alert tone="danger" title={t('designer.integrations.secretError')} />}
      <Dialog
        open={rotate}
        onOpenChange={(open) => {
          if (busy) return;
          setRotate(open);
          if (!open) setPassword('');
        }}
        title={t('designer.integrations.rotate')}
        description={t('designer.integrations.secretHelp')}
      >
        <Input
          label={t('designer.integrations.name')}
          value={name}
          disabled={!!secretRef}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Input
          label={t('designer.integrations.secretValue')}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <Button
          loading={busy}
          disabled={!password || !name}
          onClick={() => {
            setBusy(true);
            setError(false);
            const body = { name, kind: selected?.kind ?? 'generic', value: password };
            setPassword('');
            void request(secretRef ? `/v1/secrets/${secretRef}` : '/v1/secrets', Metadata, {
              method: secretRef ? 'PUT' : 'POST',
              csrf: session.csrfToken,
              body,
            })
              .then((secret) => {
                void secrets.refetch();
                if ('secretRef' in value) change({ ...value, secretRef: secret.id });
                setRotate(false);
              })
              .catch(() => {
                setError(true);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {t('designer.integrations.save')}
        </Button>
      </Dialog>
    </section>
  );
}
