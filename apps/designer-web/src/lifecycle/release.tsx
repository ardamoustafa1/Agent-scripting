import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Alert, Badge, Button, Input, Textarea, Select, Dialog } from '@verbis/ui';

import { request, VersionsSchema, ResourceSchema, ApiError } from '../api/client.js';
import { EditorDocumentSchema, EditorStore } from '../editor/store.js';
import { previewLint } from '../preview/lint.js';
import { RegressionPanel } from '../preview/regression-panel.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';

import { draftFromChanges } from './change-summary-text.js';
import { summarizeChanges } from './change-summary.js';
import { Comments } from './comments.js';
import { ReleaseRisk } from './release-risk.js';
import { Suggestions } from './suggestions.js';
import { VisualDiff } from './visual-diff.js';
import './styles.css';

const Reviews = z.array(
  z.object({
    id: z.string(),
    reviewer: z.string(),
    decision: z.string(),
    comment: z.string().nullable(),
    reason: z.string().nullable(),
    createdAt: z.string(),
  }),
);
export default function ReleasePage() {
  const [searchParams] = useSearchParams();
  const { id = '', number = '1' } = useParams(),
    { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    client = useQueryClient();
  const key = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'release',
    id,
    number,
  ];
  const current = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id}/versions/${number}`, EditorDocumentSchema, { signal }),
  });
  const versions = useQuery({
    queryKey: [...key, 'versions'],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id}/versions?limit=100&sort=-number`, VersionsSchema, { signal }),
  });
  const script = useQuery({
    queryKey: [...key, 'script'],
    queryFn: ({ signal }) => request(`/v1/scripts/${id}`, ResourceSchema, { signal }),
  });
  const [baseline, setBaseline] = useState(''),
    [semver, setSemver] = useState(''),
    [note, setNote] = useState(''),
    [comment, setComment] = useState(''),
    [at, setAt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [success, setSuccess] = useState(false),
    [rollbackOpen, setRollbackOpen] = useState(false);
  const from =
    baseline ||
    String(
      versions.data?.data.find((v) => v.number < Number(number) && v.state === 'published')
        ?.number ?? number,
    );
  const patch = useQuery({
    queryKey: [...key, 'patch', from],
    queryFn: ({ signal }) =>
      request(
        `/v1/scripts/${id}/versions/${from}/diff/${number}`,
        z.object({
          patch: z.array(
            z.object({
              op: z.enum(['add', 'remove', 'replace']),
              path: z.string(),
              value: z.unknown().optional(),
            }),
          ),
        }),
        { signal },
      ),
  });
  const previous = useQuery({
    queryKey: [...key, 'from', from],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id}/versions/${from}`, EditorDocumentSchema, { signal }),
  });
  const schedules = useQuery({
    queryKey: [...key, 'schedules'],
    queryFn: ({ signal }) =>
      request(
        `/v1/scripts/${id}/versions/${number}/schedules`,
        z.array(
          z.object({
            id: z.uuid(),
            state: z.string(),
            runAt: z.string(),
            completedAt: z.string().nullable(),
          }),
        ),
        { signal },
      ),
    refetchInterval: 30000,
  });
  const reviews = useQuery({
    queryKey: [...key, 'reviews'],
    queryFn: ({ signal }) =>
      request(`/v1/scripts/${id}/versions/${number}/reviews`, Reviews, { signal }),
  });
  const command = async (
    action: string,
    body?: unknown,
    path = `/v1/scripts/${id}/versions/${number}/${action}`,
  ) => {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await request(path, z.unknown(), {
        method: 'POST',
        csrf: session.csrfToken,
        ...(body === undefined ? {} : { body }),
      });
      setSuccess(true);
      setRollbackOpen(false);
      await client.invalidateQueries({ queryKey: ['workspace'] });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === 'VERBIS_AUTHZ_SCOPE_MISSING'
          ? 'designer.workspace.scopeMissing'
          : 'designer.lifecycle.failed',
      );
    } finally {
      setBusy(false);
    }
  };
  if (current.isError)
    return <Failure error={current.error} retry={() => void current.refetch()} />;
  if (!current.data) return <Loading />;
  const version = current.data,
    lint = previewLint(version.document, new EditorStore(version.document).issues());
  const changeLines =
    from !== number && previous.data
      ? summarizeChanges(previous.data.document, version.document)
      : null;
  const head = versions.data?.data.find((v) => v.id === script.data?.currentVersionId);
  const rollback = versions.data?.data.find(
    (v) => v.state === 'published' && v.number < (head?.number ?? 0),
  );
  return (
    <section className="lc-release">
      <Link className="dw-script-back" to={`/scripts/${id}/releases`}>
        <ArrowLeft size={16} aria-hidden />
        {t('designer.workspace.back')}
      </Link>
      <header className="lc-release-header">
        <div className="lc-release-identity">
          <span className="dw-script-mark" aria-hidden>
            <GitPullRequest size={24} />
          </span>
          <div>
            <div className="dw-eyebrow">{t('designer.lifecycle.reviewRelease')}</div>
            <div className="lc-release-title">
              <h1>{version.document.meta.name}</h1>
              <Badge>{t('designer.lifecycle.versionLabel', { number })}</Badge>
            </div>
            <p>{t('designer.lifecycle.releaseHelp')}</p>
          </div>
        </div>
        <div className="lc-release-header-actions">
          {head?.number === Number(number) && (
            <Badge tone="success">{t('designer.lifecycle.activeVersion')}</Badge>
          )}
          <Badge tone={version.state === 'published' ? 'success' : 'info'}>
            {t(`designer.workspace.status.${version.state}`)}
          </Badge>
          <Link
            className="vb-button"
            data-variant="secondary"
            data-size="md"
            to={`/scripts/${id}/versions/${number}/edit`}
          >
            <Pencil size={16} aria-hidden />
            {t('designer.editor.title')}
          </Link>
        </div>
      </header>
      {error && <Alert tone="danger" title={t(error)} />}
      {(version.document.testScenarios?.length ?? 0) === 0 && (
        <Alert tone="warning" title={t('designer.preview.scenariosRequired')} />
      )}
      {success && <Alert tone="success" title={t('designer.lifecycle.done')} />}
      <ReleaseRisk
        scriptId={id}
        queryKey={[...key, version.version, from]}
        document={version.document}
        baseline={from === number ? undefined : previous.data?.document}
        patch={from === number ? [] : patch.data?.patch}
      />
      <Dialog
        open={rollbackOpen}
        onOpenChange={(open) => {
          if (!busy) setRollbackOpen(open);
        }}
        title={t('designer.lifecycle.confirmRollback')}
        description={t('designer.lifecycle.rollbackImpact')}
      >
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setRollbackOpen(false);
          }}
        >
          {t('designer.lifecycle.cancelRollback')}
        </Button>
        <Button
          variant="danger"
          loading={busy}
          disabled={!rollback || !script.data?.currentVersionId}
          onClick={() => {
            if (rollback && script.data?.currentVersionId)
              void command(
                'rollback',
                {
                  targetNumber: rollback.number,
                  expectedCurrentVersionId: script.data.currentVersionId,
                },
                `/v1/scripts/${id}/rollback`,
              );
          }}
        >
          {t('designer.lifecycle.confirmRollback')}
        </Button>
      </Dialog>
      <div className="lc-release-grid">
        <article className="lc-card">
          <h2>{t('designer.lifecycle.actions')}</h2>
          {version.state === 'draft' && ability.can('update', 'Script') && (
            <>
              <Input
                label={t('designer.lifecycle.semver')}
                value={semver}
                onChange={(e) => {
                  setSemver(e.target.value);
                }}
                placeholder="1.0.0"
              />
              <Button
                variant="secondary"
                disabled={!changeLines || changeLines.length === 0}
                aria-describedby="lc-draft-hint"
                onClick={() => {
                  if (changeLines)
                    setNote((current) =>
                      [
                        current.trim(),
                        draftFromChanges(changeLines, (key, options) =>
                          options ? t(key, options) : t(key),
                        ),
                      ]
                        .filter(Boolean)
                        .join('\n')
                        .slice(0, 4000),
                    );
                }}
              >
                {t('designer.lifecycle.draftFromChanges')}
              </Button>
              <p id="lc-draft-hint" className="lc-empty-note">
                {t('designer.lifecycle.draftFromChangesHint')}
              </p>
              <Textarea
                label={t('designer.lifecycle.changeNote')}
                required
                maxLength={4000}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
              <Button
                loading={busy}
                disabled={!note.trim() || !/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(semver)}
                onClick={() => void command('submit', { semver, changeNote: note })}
              >
                {t('designer.lifecycle.submit')}
              </Button>
            </>
          )}
          {version.state === 'in_review' && (
            <>
              <Textarea
                label={t('designer.lifecycle.reviewComment')}
                maxLength={4000}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                }}
              />
              {ability.can('approve', 'Script') && (
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={!comment.trim()}
                  onClick={() =>
                    void command('reviews', {
                      decision: 'rejected',
                      reason: comment.slice(0, 2000),
                      comment,
                    })
                  }
                >
                  {t('designer.lifecycle.reject')}
                </Button>
              )}
              <Button
                variant="secondary"
                loading={busy}
                disabled={!comment.trim()}
                onClick={() => void command('reviews', { decision: 'commented', comment })}
              >
                {t('designer.lifecycle.comment')}
              </Button>
              {ability.can('update', 'Script') && (
                <Button variant="ghost" loading={busy} onClick={() => void command('withdraw')}>
                  {t('designer.lifecycle.withdraw')}
                </Button>
              )}
            </>
          )}
          {version.state === 'approved' && ability.can('publish', 'Script') && (
            <>
              <Input
                label={t('designer.lifecycle.scheduleAt')}
                type="datetime-local"
                value={at}
                onChange={(e) => {
                  setAt(e.target.value);
                }}
              />
              <Button
                loading={busy}
                disabled={!at || Number.isNaN(Date.parse(at))}
                onClick={() => void command('schedule', { at: new Date(at).toISOString() })}
              >
                {t('designer.lifecycle.schedule')}
              </Button>
            </>
          )}
          {rollback && script.data?.currentVersionId && ability.can('publish', 'Script') && (
            <>
              <p>{t('designer.lifecycle.rollbackHelp')}</p>
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => {
                  setRollbackOpen(true);
                }}
              >
                {t('designer.lifecycle.rollback', { number: rollback.number })}
              </Button>
            </>
          )}
          <ul className="lc-schedules">
            {schedules.data?.map((job) => (
              <li key={job.id}>
                <Badge>{t(`designer.lifecycle.scheduleStates.${job.state}`)}</Badge>{' '}
                <time>{job.runAt}</time>
              </li>
            ))}
          </ul>
          <RegressionPanel
            scriptId={id}
            number={version.number}
            documentVersion={version.version}
            state={version.state}
          />
        </article>
        <article className="lc-card">
          <h2>{t('designer.lifecycle.lint')}</h2>
          <Badge tone={lint.some((i) => i.severity === 'error') ? 'danger' : 'success'}>
            {lint.length}
          </Badge>
          {lint.length === 0 && (
            <p className="lc-empty-note">{t('designer.lifecycle.noLintIssues')}</p>
          )}
          <ul>
            {lint.map((issue, i) => (
              <li key={i}>
                <code>{issue.path}</code> {t(issue.messageKey, issue.params ?? {})}
              </li>
            ))}
          </ul>
          <h2>{t('designer.lifecycle.reviews')}</h2>
          {reviews.isError && <Alert tone="danger" title={t('designer.lifecycle.failed')} />}
          {reviews.data?.length === 0 && (
            <p className="lc-empty-note">{t('designer.lifecycle.noReviews')}</p>
          )}
          <ol>
            {reviews.data?.map((review) => (
              <li key={review.id}>
                <Badge>{t(`designer.lifecycle.${review.decision}`)}</Badge> {review.reviewer}
                <p>{review.comment ?? review.reason}</p>
                <time>{review.createdAt}</time>
              </li>
            ))}
          </ol>
        </article>
      </div>
      <article className="lc-card">
        <h2>{t('designer.lifecycle.diff')}</h2>
        <Select
          label={t('designer.lifecycle.baseline')}
          value={from}
          onValueChange={setBaseline}
          options={(versions.data?.data ?? []).map((v) => ({
            value: String(v.number),
            label: `v${v.number}`,
          }))}
        />
        {previous.data ? (
          <VisualDiff
            before={previous.data.document}
            after={version.document}
            patch={patch.data?.patch ?? []}
          />
        ) : previous.isError ? (
          <Failure error={previous.error} retry={() => void previous.refetch()} />
        ) : (
          <Loading />
        )}
      </article>
      <Comments
        scriptId={id}
        number={version.number}
        nodeId="script"
        focusedThreadId={searchParams.get('thread') ?? ''}
      />
      <Suggestions scriptId={id} number={version.number} />
    </section>
  );
}
