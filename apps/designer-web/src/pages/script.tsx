import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  GitBranch,
  FlaskConical,
  Layers3,
  Megaphone,
  Pencil,
  Plus,
  Workflow,
} from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Badge, DataTable, Tabs, EmptyState, Button, Dialog } from '@verbis/ui';

import { request, ResourceSchema, VersionsSchema } from '../api/client.js';
import { newDocument } from '../editor/new-document.js';
import { EditorDocumentSchema } from '../editor/store.js';
import { Branches } from '../lifecycle/branches.js';
import { RegressionPanel } from '../preview/regression-panel.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';

const DocumentSchema = z.object({
  document: z.object({
    variables: z.array(
      z.object({
        key: z.string(),
        type: z.string(),
        scope: z.string(),
        classification: z.string(),
      }),
    ),
  }),
});
export default function ScriptPage() {
  const { id } = useParams();
  const ability = useAbility();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { session } = useWorkspace();
  const key = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'script',
    id,
  ];
  const script = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request(`/v1/scripts/${id ?? ''}`, ResourceSchema, { signal }),
  });
  const versions = useQuery({
    queryKey: [...key, 'versions'],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id ?? ''}/versions?limit=100&sort=-number`, VersionsSchema, {
        signal,
      }),
  });
  const queryClient = useQueryClient();
  const latestVersion = versions.data?.data[0];
  const latest = latestVersion?.number;
  const creationKey = useRef<{ source: string; key: string } | null>(null);
  const createDraft = useMutation({
    mutationFn: async () => {
      if (!id || !script.data || !ability.can('create', 'Script'))
        throw new Error('VERBIS_FORBIDDEN');
      const source = `${id}:${latest ?? 'first'}`;
      if (creationKey.current?.source !== source)
        creationKey.current = { source, key: crypto.randomUUID() };
      const previous =
        latest === undefined
          ? null
          : await request(`/v1/scripts/${id}/versions/${latest}`, EditorDocumentSchema);
      return request(
        `/v1/scripts/${id}/versions`,
        z.object({ number: z.number().int().positive() }),
        {
          method: 'POST',
          csrf: session.csrfToken,
          idempotencyKey: creationKey.current.key,
          body: {
            document:
              previous?.document ??
              newDocument({
                id,
                name: script.data.name,
                pageName: t('designer.editor.pageDefault', { number: 1 }),
                next: {
                  tr: t('designer.workspace.next', { lng: 'tr' }),
                  en: t('designer.workspace.next', { lng: 'en' }),
                },
              }),
            screens:
              previous?.screens.map(({ sharedScreenId, versionNumber, mode }) => ({
                sharedScreenId,
                versionNumber,
                mode,
              })) ?? [],
          },
        },
      );
    },
    onSuccess: (version) => {
      creationKey.current = null;
      void queryClient.invalidateQueries({ queryKey: key });
      void navigate(`/scripts/${id}/versions/${version.number}/edit`);
    },
  });
  const document = useQuery({
    queryKey: [...key, 'document', latest],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id ?? ''}/versions/${latest ?? 1}`, DocumentSchema, { signal }),
    enabled: latest !== undefined,
  });
  if (script.isError)
    return (
      <Failure
        error={script.error}
        retry={() => {
          void script.refetch();
        }}
      />
    );
  if (!script.data) return <Loading />;
  return (
    <section className="dw-script-detail">
      <Link className="dw-script-back" to="/scripts">
        <ArrowLeft size={16} aria-hidden />
        {t('designer.workspace.back')}
      </Link>
      <header className="dw-script-header">
        <div className="dw-script-identity">
          <span className="dw-script-mark" aria-hidden>
            <Workflow size={24} />
          </span>
          <div>
            <div className="dw-eyebrow">{t('designer.workspace.nav.scripts')}</div>
            <h1>{script.data.name}</h1>
            {script.data.description && <p>{script.data.description}</p>}
          </div>
        </div>
        <div className="dw-script-primary-actions">
          {versions.data && latestVersion?.state !== 'draft' && ability.can('create', 'Script') && (
            <Button
              loading={createDraft.isPending}
              startIcon={<Plus size={16} aria-hidden />}
              onClick={() => {
                createDraft.mutate();
              }}
            >
              {t(
                latest === undefined
                  ? 'designer.workspace.createFirstDraft'
                  : 'designer.workspace.createNextDraft',
              )}
            </Button>
          )}
          {latest && ability.can('update', 'Script') && (
            <Button
              variant={latestVersion.state === 'draft' ? 'primary' : 'secondary'}
              startIcon={<Pencil size={16} aria-hidden />}
              onClick={() => {
                void navigate(`/scripts/${id}/versions/${latest}/edit`);
              }}
            >
              {t('designer.editor.title')}
            </Button>
          )}
        </div>
      </header>
      <nav className="dw-script-tools" aria-label={t('designer.workspace.scriptActions')}>
        <Link
          className="dw-script-tool"
          aria-label={t('designer.lifecycle.assignments')}
          to={`/scripts/${id}/assignments`}
        >
          <span className="dw-script-tool-icon" aria-hidden>
            <Megaphone size={20} />
          </span>
          <span>
            <strong>{t('designer.lifecycle.assignments')}</strong>
            <span>{t('designer.workspace.assignmentsHint')}</span>
          </span>
          <ArrowUpRight size={16} aria-hidden />
        </Link>
        <Link
          className="dw-script-tool"
          aria-label={t('designer.lifecycle.transport')}
          to={`/scripts/${id}/packages`}
        >
          <span className="dw-script-tool-icon" aria-hidden>
            <GitBranch size={20} />
          </span>
          <span>
            <strong>{t('designer.lifecycle.transport')}</strong>
            <span>{t('designer.workspace.transportHint')}</span>
          </span>
          <ArrowUpRight size={16} aria-hidden />
        </Link>
      </nav>
      {createDraft.isError && (
        <Failure
          retry={() => {
            createDraft.mutate();
          }}
        />
      )}
      <div className="dw-script-panel">
        <Tabs
          label={t('designer.workspace.nav.scripts')}
          value={location.pathname.endsWith('/variables') ? 'variables' : 'versions'}
          onValueChange={(value) =>
            void navigate(
              `/scripts/${id ?? ''}/${value === 'variables' ? 'variables' : 'releases'}`,
            )
          }
          items={[
            {
              value: 'versions',
              label: t('designer.workspace.nav.releases'),
              content: versions.isPending ? (
                <Loading />
              ) : versions.isError ? (
                <Failure
                  error={versions.error}
                  retry={() => {
                    void versions.refetch();
                  }}
                />
              ) : versions.data.data.length === 0 ? (
                <div className="dw-script-empty">
                  <EmptyState
                    headingLevel={2}
                    icon={<Layers3 size={28} />}
                    title={t('designer.workspace.noVersions')}
                    description={t('designer.workspace.firstDraftHint')}
                  />
                </div>
              ) : (
                <>
                  <DataTable
                    label={t('designer.workspace.nav.releases')}
                    data={versions.data.data}
                    getRowId={(row) => row.id}
                    columns={[
                      {
                        id: 'number',
                        header: t('designer.workspace.version'),
                        accessor: (row) => row.number,
                        cell: (row) => (
                          <>
                            {row.number}
                            {row.branch ? <Badge tone="info">{row.branch}</Badge> : null}
                          </>
                        ),
                      },
                      {
                        id: 'status',
                        header: t('designer.workspace.statusFilter'),
                        accessor: (row) => row.state,
                        cell: (row) => (
                          <Badge
                            tone={
                              row.state === 'published'
                                ? 'success'
                                : row.state === 'in_review'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {t(`designer.workspace.status.${row.state}`, {
                              defaultValue: row.state,
                            })}
                          </Badge>
                        ),
                      },
                      {
                        id: 'owner',
                        header: t('designer.workspace.owner'),
                        accessor: (row) => row.createdBy ?? t('designer.workspace.unassigned'),
                      },
                      {
                        id: 'release',
                        header: t('designer.lifecycle.reviewRelease'),
                        accessor: (row) => row.number,
                        cell: (row) => (
                          <Link
                            className="dw-action-link"
                            to={`/scripts/${id}/versions/${row.number}/release`}
                          >
                            {t('designer.lifecycle.reviewRelease')}
                            <ArrowUpRight size={14} aria-hidden />
                          </Link>
                        ),
                      },
                      ...(ability.can('read', 'Session')
                        ? [
                            {
                              id: 'replay',
                              header: t('designer.replay.link'),
                              accessor: (row: { number: number }) => row.number,
                              cell: (row: { number: number }) => (
                                <Link
                                  className="dw-action-link"
                                  to={`/scripts/${id}/versions/${row.number}/replay`}
                                >
                                  {t('designer.replay.link')}
                                  <ArrowUpRight size={14} aria-hidden />
                                </Link>
                              ),
                            },
                          ]
                        : []),
                      {
                        id: 'regression',
                        header: t('designer.preview.regression'),
                        accessor: (row) => row.number,
                        cell: (row) => (
                          <Dialog
                            className="dw-regression-dialog"
                            title={t('designer.preview.regression')}
                            description={t('designer.lifecycle.versionLabel', {
                              number: row.number,
                            })}
                            trigger={
                              <Button
                                variant="secondary"
                                size="sm"
                                startIcon={<FlaskConical size={16} aria-hidden />}
                              >
                                {t('designer.preview.regression')}
                              </Button>
                            }
                            footer={
                              <Link
                                className="dw-action-link"
                                to={`/scripts/${id}/versions/${row.number}/edit`}
                              >
                                {t('designer.preview.title')}
                                <ArrowUpRight size={16} aria-hidden />
                              </Link>
                            }
                          >
                            <RegressionPanel
                              scriptId={id ?? ''}
                              number={row.number}
                              state={row.state}
                              showHeading={false}
                            />
                          </Dialog>
                        ),
                      },
                      {
                        id: 'date',
                        header: t('designer.workspace.edited'),
                        accessor: (row) => row.createdAt,
                        cell: (row) => (
                          <time dateTime={row.createdAt} title={row.createdAt}>
                            {Number.isNaN(Date.parse(row.createdAt))
                              ? row.createdAt
                              : new Intl.DateTimeFormat(i18n.language, {
                                  dateStyle: 'medium',
                                }).format(new Date(row.createdAt))}
                          </time>
                        ),
                      },
                    ]}
                  />
                  <Branches
                    scriptId={id ?? ''}
                    mainline={versions.data.data.filter((v) => !v.branch).map((v) => v.number)}
                    onChanged={() => void versions.refetch()}
                  />
                </>
              ),
            },
            {
              value: 'variables',
              label: t('designer.workspace.nav.variables'),
              content: document.isError ? (
                <Failure
                  error={document.error}
                  retry={() => {
                    void document.refetch();
                  }}
                />
              ) : document.isPending && latest !== undefined ? (
                <Loading />
              ) : document.data ? (
                <DataTable
                  label={t('designer.workspace.nav.variables')}
                  data={document.data.document.variables}
                  getRowId={(row) => row.key}
                  columns={[
                    { id: 'key', header: t('designer.workspace.name'), accessor: (row) => row.key },
                    {
                      id: 'type',
                      header: t('designer.workspace.kind'),
                      accessor: (row) => row.type,
                    },
                    {
                      id: 'scope',
                      header: t('designer.workspace.scope'),
                      accessor: (row) => row.scope,
                    },
                    {
                      id: 'classification',
                      header: t('designer.workspace.classification'),
                      accessor: (row) => row.classification,
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  title={t('designer.workspace.noVersions')}
                  description={t('designer.workspace.emptyDescription')}
                />
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}
