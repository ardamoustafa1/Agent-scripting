import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Alert, Badge, Button, Dialog, Input, Select, Textarea } from '@verbis/ui';

import { list, request, VersionsSchema } from '../api/client.js';
import { EditorDocumentSchema } from '../editor/store.js';
import { useWorkspace } from '../workspace/context.js';
import { Failure, Loading } from '../workspace/states.js';

const Screens = z.array(
  z.object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    latest: z.object({ number: z.number(), semver: z.string() }).nullable(),
  }),
);

/** Shared screens are authored from an authorized script page, with its dependency bundle. */
export default function SharedScreens() {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    client = useQueryClient();
  const scope = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'shared-screens',
  ];
  const [open, setOpen] = useState(false),
    [target, setTarget] = useState<string | null>(null),
    [key, setKey] = useState(''),
    [name, setName] = useState(''),
    [semver, setSemver] = useState('1.0.0'),
    [note, setNote] = useState(''),
    [sourceId, setSourceId] = useState(''),
    [sourceVersion, setSourceVersion] = useState(''),
    [pageId, setPageId] = useState(''),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const screens = useQuery({
    queryKey: scope,
    queryFn: ({ signal }) => request('/v1/shared-screens', Screens, { signal }),
  });
  const scripts = useInfiniteQuery({
    queryKey: [...scope, 'sources'],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) => list('scripts', signal, pageParam || undefined),
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled: open && ability.can('read', 'Script'),
  });
  const versions = useQuery({
    queryKey: [...scope, 'source-versions', sourceId],
    enabled: open && !!sourceId,
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${sourceId}/versions?limit=100&sort=-number`, VersionsSchema, {
        signal,
      }),
  });
  const source = useQuery({
    queryKey: [...scope, 'source', sourceId, sourceVersion],
    enabled: open && !!sourceId && !!sourceVersion,
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${sourceId}/versions/${sourceVersion}`, EditorDocumentSchema, {
        signal,
      }),
  });
  const page = source.data?.document.pages.find((p) => p.id === pageId);
  const begin = (id: string | null) => {
    setTarget(id);
    setKey('');
    setName('');
    setSemver(id ? '' : '1.0.0');
    setNote('');
    setSourceId('');
    setSourceVersion('');
    setPageId('');
    setFailed(false);
    setOpen(true);
  };
  const save = async () => {
    if (!page || !source.data) return;
    setBusy(true);
    setFailed(false);
    const doc = source.data.document;
    try {
      await request(
        target ? `/v1/shared-screens/${target}/versions` : '/v1/shared-screens',
        z.unknown(),
        {
          method: 'POST',
          csrf: session.csrfToken,
          body: {
            ...(target ? {} : { key: key.trim(), name: name.trim() }),
            semver,
            changeNote: note.trim(),
            fragment: {
              pages: [page],
              variables: doc.variables,
              dataSources: doc.dataSources,
              messages: doc.i18n.messages,
            },
          },
        },
      );
      setOpen(false);
      await client.invalidateQueries({ queryKey: ['workspace'] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (screens.isError)
    return <Failure error={screens.error} retry={() => void screens.refetch()} />;
  if (!screens.data) return <Loading />;
  return (
    <section className="ig-stack">
      <h1>{t('designer.workspace.nav.screens')}</h1>
      <p>{t('designer.screens.help')}</p>
      {ability.can('create', 'Screen') && (
        <Button
          onClick={() => {
            begin(null);
          }}
        >
          {t('designer.screens.create')}
        </Button>
      )}
      {!screens.data.length && <p>{t('designer.screens.empty')}</p>}
      {screens.data.map((screen) => (
        <article className="lc-card" key={screen.id}>
          <h2>{screen.name}</h2>
          <Badge>{screen.latest?.semver ?? '—'}</Badge>
          {ability.can('update', 'Screen') && (
            <Button
              variant="secondary"
              onClick={() => {
                begin(screen.id);
              }}
            >
              {t('designer.screens.publish')}
            </Button>
          )}
        </article>
      ))}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title={t(target ? 'designer.screens.publish' : 'designer.screens.create')}
        description={t('designer.screens.help')}
      >
        <form
          className="ig-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {!target && (
            <>
              <Input
                label={t('designer.screens.key')}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                }}
                required
                pattern="[a-z][a-z0-9-]*"
                maxLength={64}
              />
              <Input
                label={t('designer.workspace.name')}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                required
                maxLength={120}
              />
            </>
          )}
          <Select
            label={t('designer.screens.source')}
            value={sourceId}
            options={(scripts.data?.pages.flatMap((p) => p.data) ?? []).map((row) => ({
              value: row.id,
              label: row.name,
            }))}
            onValueChange={(id) => {
              setSourceId(id);
              setSourceVersion('');
              setPageId('');
            }}
          />
          {scripts.hasNextPage && (
            <Button
              type="button"
              loading={scripts.isFetchingNextPage}
              onClick={() => void scripts.fetchNextPage()}
            >
              {t('designer.workspace.loadMore')}
            </Button>
          )}
          <Select
            label={t('designer.screens.sourceVersion')}
            value={sourceVersion}
            options={(versions.data?.data ?? []).map((version) => ({
              value: String(version.number),
              label: `v${version.number}`,
            }))}
            onValueChange={(version) => {
              setSourceVersion(version);
              setPageId('');
            }}
          />
          <Select
            label={t('designer.preview.page')}
            value={pageId}
            options={(source.data?.document.pages ?? []).map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            onValueChange={setPageId}
          />
          <Input
            label={t('designer.lifecycle.semver')}
            value={semver}
            onChange={(event) => {
              setSemver(event.target.value);
            }}
            required
            pattern="[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?"
          />
          <Textarea
            label={t('designer.lifecycle.changeNote')}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            required
            maxLength={4000}
          />
          {(failed || scripts.isError || versions.isError || source.isError) && (
            <Alert tone="danger" title={t('designer.lifecycle.failed')} />
          )}
          <Button
            type="submit"
            loading={busy}
            disabled={!page || !note.trim() || (!target && (!key.trim() || !name.trim()))}
          >
            {t('designer.screens.save')}
          </Button>
        </form>
      </Dialog>
    </section>
  );
}
