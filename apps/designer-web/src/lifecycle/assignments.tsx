import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';

import { useAbility } from '@verbis/authz/react';
import { PredicateSchema, type Predicate } from '@verbis/script-schema';
import { Alert, Button, Input, MultiSelect, Select, Textarea, Badge } from '@verbis/ui';

import { request, PageSchema, VersionsSchema } from '../api/client.js';
import { RuleBuilder, containsExpression } from '../rules/builder.js';
import { useWorkspace } from '../workspace/context.js';
import { Loading, Failure } from '../workspace/states.js';
import './styles.css';

const Row = z.object({
  id: z.uuid(),
  scriptId: z.uuid(),
  campaignId: z.uuid(),
  version: z.number().int(),
  priority: z.number(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  expression: PredicateSchema.nullable(),
  variants: z
    .array(z.object({ key: z.string(), weight: z.number(), pinnedVersionId: z.uuid().optional() }))
    .nullable(),
});
const localDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
type Assignment = z.infer<typeof Row>;
const Page = z.object({
  data: z.array(Row),
  page: z.object({ nextCursor: z.string().nullable() }),
});
function SortRow({
  row,
  edit,
  disabled,
  name,
}: {
  row: Assignment;
  edit: () => void;
  disabled: boolean;
  name: string;
}) {
  const { t } = useTranslation();
  const { setNodeRef, transform, transition, attributes, listeners } = useSortable({
    id: row.id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
      className="lc-assignment"
    >
      <Button
        variant="ghost"
        disabled={disabled}
        aria-label={t('designer.lifecycle.reorder', { name })}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </Button>
      <strong>{name}</strong>
      <Badge>{row.priority}</Badge>
      <span>{[row.effectiveFrom, row.effectiveTo].filter(Boolean).join(' – ')}</span>
      <span>{row.variants?.map((v) => `${v.key}: ${v.weight / 100}%`).join(' / ')}</span>
      <Button variant="secondary" disabled={disabled} onClick={edit}>
        {t('designer.editor.apply')}
      </Button>
    </li>
  );
}
export default function AssignmentsPage() {
  const { id = '' } = useParams(),
    { t } = useTranslation(),
    { session } = useWorkspace(),
    client = useQueryClient(),
    ability = useAbility();
  const key = [
    'workspace',
    session.user.tenantId,
    session.user.id,
    session.session.id,
    'script-assignments',
    id,
  ];
  const [priorityCampaign, setPriorityCampaign] = useState('all'),
    [aVersion, setAVersion] = useState('policy'),
    [bVersion, setBVersion] = useState('policy');
  const assignments = useQuery({
    queryKey: [...key, priorityCampaign],
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) =>
      request(
        `/v1/assignments?${priorityCampaign === 'all' ? `scriptId=${id}` : `campaignId=${priorityCampaign}`}&limit=100&sort=priority`,
        Page,
        { signal },
      ),
  });
  const campaigns = useQuery({
    queryKey: [...key, 'campaigns'],
    queryFn: ({ signal }) => request('/v1/campaigns?limit=100', PageSchema, { signal }),
  });
  const scripts = useQuery({
    queryKey: [...key, 'scripts'],
    queryFn: ({ signal }) => request('/v1/scripts?limit=100', PageSchema, { signal }),
  });
  const [pendingRows, setRows] = useState<{
      source: typeof assignments.data;
      rows: Assignment[];
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<Assignment | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [ab, setAb] = useState('50'),
    [useAb, setUseAb] = useState(false),
    [condition, setCondition] = useState<Predicate>({ fact: 'interaction.channel', op: 'exists' }),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [channel, setChannel] = useState('voice'),
    [campaign, setCampaign] = useState(''),
    [input, setInput] = useState('{}'),
    [result, setResult] = useState<unknown>(undefined);
  const variantVersions = useQuery({
    queryKey: [...key, 'variants', editing?.scriptId ?? id],
    queryFn: ({ signal }) =>
      request(
        `/v1/scripts/${editing?.scriptId ?? id}/versions?limit=100&sort=-number`,
        VersionsSchema,
        { signal },
      ),
  });
  const rows =
    pendingRows && pendingRows.source === assignments.data
      ? pendingRows.rows
      : (assignments.data?.data ?? []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const writable = ability.can('update', 'Campaign');
  const perform = async (path: string, body: unknown) => {
    setBusy(true);
    setFailed(false);
    try {
      const value = await request(path, z.unknown(), {
        method: 'POST',
        csrf: session.csrfToken,
        body,
      });
      await client.invalidateQueries({ queryKey: ['workspace'] });
      return value;
    } catch {
      setFailed(true);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const drag = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const next = arrayMove(
      rows,
      rows.findIndex((r) => r.id === event.active.id),
      rows.findIndex((r) => r.id === event.over?.id),
    );
    setRows({ source: assignments.data, rows: next });
  };
  const patch = () => ({
    effectiveFrom: from ? new Date(from).toISOString() : null,
    effectiveTo: to ? new Date(to).toISOString() : null,
    expression: condition,
    variants: useAb
      ? [
          {
            key: 'a',
            weight: Number(ab) * 100,
            ...(aVersion === 'policy' ? {} : { pinnedVersionId: aVersion }),
          },
          {
            key: 'b',
            weight: 10000 - Number(ab) * 100,
            ...(bVersion === 'policy' ? {} : { pinnedVersionId: bVersion }),
          },
        ]
      : null,
  });
  const valid =
    (!from || !Number.isNaN(Date.parse(from))) &&
    (!to || !Number.isNaN(Date.parse(to))) &&
    (!from || !to || Date.parse(to) > Date.parse(from)) &&
    (!useAb || (/^\d+$/.test(ab) && Number(ab) > 0 && Number(ab) < 100));
  if (assignments.isError || campaigns.isError)
    return (
      <Failure
        retry={() => {
          void assignments.refetch();
          void campaigns.refetch();
        }}
      />
    );
  if (!assignments.data || !campaigns.data) return <Loading />;
  const options = campaigns.data.data.map((c) => ({ value: c.id, label: c.name }));
  return (
    <section>
      <Link className="dw-back" to={`/scripts/${id}`}>
        {t('designer.workspace.back')}
      </Link>
      <div className="dw-page-heading">
        <div>
          <h1>{t('designer.lifecycle.assignments')}</h1>
          <p>{t('designer.lifecycle.assignmentHelp')}</p>
        </div>
      </div>
      {failed && <Alert tone="danger" title={t('designer.lifecycle.failed')} />}
      <div className="lc-release-grid">
        <article className="lc-card">
          <h2>{t('designer.lifecycle.priorities')}</h2>
          <Select
            label={t('designer.lifecycle.priorityCampaign')}
            value={priorityCampaign}
            onValueChange={(value) => {
              setPriorityCampaign(value);
              setEditing(null);
            }}
            options={[{ value: 'all', label: t('designer.lifecycle.scriptBindings') }, ...options]}
          />
          <DndContext sensors={sensors} onDragEnd={drag}>
            <SortableContext items={rows.map((r) => r.id)}>
              <ol>
                {rows.map((row) => (
                  <SortRow
                    key={row.id}
                    row={row}
                    disabled={!writable || busy}
                    name={
                      priorityCampaign === 'all'
                        ? (campaigns.data.data.find((c) => c.id === row.campaignId)?.name ??
                          row.campaignId)
                        : (scripts.data?.data.find((s) => s.id === row.scriptId)?.name ??
                          row.scriptId)
                    }
                    edit={() => {
                      setEditing(row);
                      setFrom(localDate(row.effectiveFrom));
                      setTo(localDate(row.effectiveTo));
                      setAVersion(row.variants?.[0]?.pinnedVersionId ?? 'policy');
                      setBVersion(row.variants?.[1]?.pinnedVersionId ?? 'policy');
                      setCondition(row.expression ?? { fact: 'interaction.channel', op: 'exists' });
                      setUseAb(!!row.variants);
                      setAb(String((row.variants?.[0]?.weight ?? 5000) / 100));
                    }}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          <Button
            loading={busy}
            disabled={
              !writable ||
              !rows.length ||
              priorityCampaign === 'all' ||
              !!assignments.data.page.nextCursor
            }
            onClick={() =>
              void perform('/v1/assignments/batch', {
                updates: rows.map((row, i) => ({
                  id: row.id,
                  version: row.version,
                  patch: { priority: i * 10 },
                })),
              })
            }
          >
            {t('designer.lifecycle.savePriorities')}
          </Button>
          {assignments.data.page.nextCursor && (
            <Alert tone="warning" title={t('designer.lifecycle.moreAssignments')} />
          )}
        </article>
        <article className="lc-card">
          <h2>{t(editing ? 'designer.lifecycle.editAssignment' : 'designer.lifecycle.assign')}</h2>
          {!editing && (
            <MultiSelect
              label={t('designer.workspace.nav.campaigns')}
              value={selected}
              onValueChange={setSelected}
              options={options}
              disabled={!writable}
            />
          )}
          <Input
            type="datetime-local"
            label={t('designer.lifecycle.validFrom')}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
          <Input
            type="datetime-local"
            label={t('designer.lifecycle.validTo')}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
          <Select
            label={t('designer.lifecycle.ab')}
            value={useAb ? 'on' : 'off'}
            onValueChange={(v) => {
              setUseAb(v === 'on');
            }}
            options={[
              { value: 'off', label: t('designer.lifecycle.off') },
              { value: 'on', label: t('designer.lifecycle.on') },
            ]}
          />
          {useAb && (
            <>
              <Select
                label={t('designer.lifecycle.aVersion')}
                value={aVersion}
                onValueChange={setAVersion}
                options={[
                  { value: 'policy', label: t('designer.lifecycle.versionPolicy') },
                  ...(variantVersions.data?.data ?? [])
                    .filter((v) => v.state === 'published')
                    .map((v) => ({ value: v.id, label: `v${v.number}` })),
                ]}
              />
              <Select
                label={t('designer.lifecycle.bVersion')}
                value={bVersion}
                onValueChange={setBVersion}
                options={[
                  { value: 'policy', label: t('designer.lifecycle.versionPolicy') },
                  ...(variantVersions.data?.data ?? [])
                    .filter((v) => v.state === 'published')
                    .map((v) => ({ value: v.id, label: `v${v.number}` })),
                ]}
              />
              <Input
                type="number"
                min={1}
                max={99}
                label={t('designer.lifecycle.aWeight')}
                value={ab}
                onChange={(e) => {
                  setAb(e.target.value);
                }}
              />
            </>
          )}
          <RuleBuilder
            allowExpressions={false}
            value={condition}
            onChange={setCondition}
            fields={[
              ...['channel', 'locale', 'queue', 'segment'].map((key) => ({
                path: `interaction.${key}`,
                type: 'string' as const,
                label: `interaction.${key}`,
              })),
              { path: 'interaction.skills', type: 'array', label: 'interaction.skills' },
            ]}
          />
          <Button
            loading={busy}
            disabled={
              !writable || !valid || containsExpression(condition) || (!editing && !selected.length)
            }
            onClick={() => {
              void perform(
                '/v1/assignments/batch',
                editing
                  ? { updates: [{ id: editing.id, version: editing.version, patch: patch() }] }
                  : {
                      creates: selected.map((campaignId) => ({
                        scriptId: id,
                        campaignId,
                        priority: 100,
                        ...patch(),
                      })),
                    },
              ).then((value) => {
                if (value !== undefined) {
                  setSelected([]);
                  setEditing(null);
                }
              });
            }}
          >
            {t('designer.lifecycle.save')}
          </Button>
          {editing && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
              }}
            >
              {t('designer.lifecycle.cancel')}
            </Button>
          )}
        </article>
      </div>
      <article className="lc-card">
        <h2>{t('designer.lifecycle.resolver')}</h2>
        <p>{t('designer.lifecycle.resolverHelp')}</p>
        <Select
          label={t('designer.workspace.nav.campaigns')}
          value={campaign}
          onValueChange={setCampaign}
          options={options}
        />
        <Select
          label={t('designer.preview.channel')}
          value={channel}
          onValueChange={setChannel}
          options={['voice', 'chat', 'email', 'sms', 'whatsapp', 'social', 'video'].map(
            (value) => ({ value, label: value }),
          )}
        />
        <Textarea
          label={t('designer.lifecycle.context')}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
        />
        <Button
          loading={busy}
          disabled={!campaign}
          onClick={() => {
            try {
              const attributes: unknown = JSON.parse(input);
              void perform('/v1/script-resolutions', {
                campaignId: campaign,
                channel,
                locale: 'tr',
                attributes,
              }).then(setResult);
            } catch {
              setFailed(true);
            }
          }}
        >
          {t('designer.lifecycle.resolveContext')}
        </Button>
        {result !== undefined && <pre aria-live="polite">{JSON.stringify(result, null, 2)}</pre>}
      </article>
    </section>
  );
}
