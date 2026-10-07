import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { Alert, Badge, Button, Dialog, Input, Select } from '@verbis/ui';

import { ApiError, request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

const Branch = z.object({
  name: z.string(),
  versionNumber: z.number(),
  parentNumber: z.number(),
  state: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  mergedInto: z.number().nullable(),
});
const Preview = z.object({
  baseNumber: z.number(),
  mainlineNumber: z.number(),
  branchNumber: z.number(),
  conflicts: z.array(z.object({ path: z.string(), kind: z.string() })),
  issues: z.array(z.string()),
  canMerge: z.boolean(),
});
const Merged = z.object({ number: z.number() });
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Branches of a script (ADR-0051, C3): work apart from the mainline, merge back as a new draft. */
export function Branches({
  scriptId,
  mainline,
  onChanged,
}: {
  scriptId: string;
  /** Mainline version numbers a branch can start from, newest first. */
  mainline: number[];
  /** A branch was created or merged; the version list is out of date. */
  onChanged?: () => void;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    ability = useAbility(),
    client = useQueryClient();
  const canEdit = ability.can('update', 'Script');
  const [name, setName] = useState(''),
    [from, setFrom] = useState(String(mainline[0] ?? '')),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(''),
    [merging, setMerging] = useState<string | null>(null),
    [mergedAs, setMergedAs] = useState<number | null>(null);
  const base = `/v1/scripts/${scriptId}/branches`,
    key = [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'branches',
      scriptId,
    ];
  const branches = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request(base, z.array(Branch), { signal }),
  });
  const preview = useQuery({
    queryKey: [...key, 'preview', merging],
    enabled: merging !== null,
    queryFn: ({ signal }) => request(`${base}/${merging ?? ''}/merge-preview`, Preview, { signal }),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
    onChanged?.();
  };
  const create = async () => {
    setBusy(true);
    setProblem('');
    try {
      await request(base, Branch, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { name, fromNumber: Number(from) },
      });
      setName('');
      await refresh();
    } catch (error) {
      setProblem(
        error instanceof ApiError && error.status === 409
          ? 'exists'
          : error instanceof ApiError && error.status === 400
            ? 'invalid'
            : 'failed',
      );
    } finally {
      setBusy(false);
    }
  };
  const merge = async () => {
    if (merging === null) return;
    setBusy(true);
    setProblem('');
    try {
      const created = await request(`${base}/${merging}/merge`, Merged, {
        method: 'POST',
        csrf: session.csrfToken,
        body: {},
      });
      setMergedAs(created.number);
      setMerging(null);
      await refresh();
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 409 ? 'conflict' : 'failed');
      await client.invalidateQueries({ queryKey: [...key, 'preview', merging] });
    } finally {
      setBusy(false);
    }
  };
  const validName = NAME.test(name) && name.length <= 64;
  return (
    <section className="lc-card" aria-labelledby="branches-title">
      <h2 id="branches-title">
        <GitBranch size={18} aria-hidden /> {t('designer.branches.title')}
      </h2>
      <p>{t('designer.branches.help')}</p>
      {branches.isError && <Alert tone="danger" title={t('designer.branches.failed')} />}
      {mergedAs !== null && (
        <p role="status">
          {t('designer.branches.merged', { number: mergedAs })}{' '}
          <Link to={`/scripts/${scriptId}/versions/${mergedAs}/edit`}>
            {t('designer.branches.openMerged')}
          </Link>
        </p>
      )}
      {branches.data?.length === 0 && <p>{t('designer.branches.empty')}</p>}
      <ul className="lc-threads">
        {branches.data?.map((branch) => (
          <li key={branch.name}>
            <strong>{branch.name}</strong>{' '}
            <Badge tone={branch.mergedInto === null ? 'info' : 'success'}>
              {branch.mergedInto === null
                ? t('designer.branches.open')
                : t('designer.branches.mergedInto', { number: branch.mergedInto })}
            </Badge>
            <p>
              {t('designer.branches.from', {
                version: branch.versionNumber,
                parent: branch.parentNumber,
              })}
            </p>
            <Link to={`/scripts/${scriptId}/versions/${branch.versionNumber}/edit`}>
              {t('designer.branches.edit')}
            </Link>
            {canEdit && branch.mergedInto === null && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setProblem('');
                  setMerging(branch.name);
                }}
              >
                {t('designer.branches.merge')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && mainline.length > 0 && (
        <>
          <h3>{t('designer.branches.new')}</h3>
          <Input
            label={t('designer.branches.name')}
            value={name}
            maxLength={64}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Select
            label={t('designer.branches.startFrom')}
            value={from}
            options={mainline.map((number) => ({
              value: String(number),
              label: t('designer.lifecycle.versionLabel', { number }),
            }))}
            onValueChange={setFrom}
          />
          {name !== '' && !validName && (
            <p role="alert">{t('designer.branches.problem.invalid')}</p>
          )}
          {problem && !merging && (
            <Alert tone="danger" title={t(`designer.branches.problem.${problem}`)} />
          )}
          <Button
            loading={busy}
            disabled={busy || !validName || from === ''}
            onClick={() => void create()}
          >
            {t('designer.branches.create')}
          </Button>
        </>
      )}
      <Dialog
        open={merging !== null}
        onOpenChange={(open) => {
          if (!open) setMerging(null);
        }}
        title={t('designer.branches.mergeTitle', { name: merging ?? '' })}
        description={t('designer.branches.mergeHelp')}
      >
        {preview.isPending && <p role="status">{t('designer.branches.checking')}</p>}
        {preview.isError && <Alert tone="danger" title={t('designer.branches.failed')} />}
        {preview.data && (
          <>
            <p>
              {t('designer.branches.mergePlan', {
                branch: preview.data.branchNumber,
                mainline: preview.data.mainlineNumber,
                base: preview.data.baseNumber,
              })}
            </p>
            {preview.data.conflicts.length > 0 && (
              <>
                <Alert
                  tone="warning"
                  title={t('designer.branches.conflicts', { count: preview.data.conflicts.length })}
                />
                <ul aria-label={t('designer.branches.conflictList')}>
                  {preview.data.conflicts.map((conflict) => (
                    <li key={conflict.path}>
                      <code>{conflict.path}</code> ·{' '}
                      {t(`designer.branches.kind.${conflict.kind}`, {
                        defaultValue: conflict.kind,
                      })}
                    </li>
                  ))}
                </ul>
                <p>{t('designer.branches.resolveFirst')}</p>
              </>
            )}
            {preview.data.conflicts.length === 0 && preview.data.issues.length > 0 && (
              <Alert tone="danger" title={t('designer.branches.invalidResult')} />
            )}
          </>
        )}
        {problem && merging && (
          <Alert tone="danger" title={t(`designer.branches.problem.${problem}`)} />
        )}
        <Button
          loading={busy}
          disabled={busy || !preview.data?.canMerge}
          onClick={() => void merge()}
        >
          {t('designer.branches.mergeConfirm')}
        </Button>
      </Dialog>
    </section>
  );
}
