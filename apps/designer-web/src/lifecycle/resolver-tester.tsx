import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { JsonValue } from '@verbis/script-schema';
import { Alert, Badge, Button, Input, Select } from '@verbis/ui';

import { KeyValueField } from '../preview/key-value-field.js';

/** Channels the resolver accepts (`ChannelTypeSchema`). */
export const CHANNELS = [
  'voice',
  'chat',
  'email',
  'sms',
  'whatsapp',
  'social',
  'video',
  'callback',
] as const;
const ATTRIBUTE = /^[A-Za-z0-9_]{1,64}$/;

const Decision = z.object({
  outcome: z.enum(['resolved', 'no_match']),
  reason: z.string().optional(),
  scriptId: z.string().optional(),
  version: z.object({ number: z.number(), semver: z.string().nullable() }).optional(),
  variant: z.object({ key: z.string(), bucket: z.number() }).optional(),
  workingHours: z.object({ configured: z.boolean(), open: z.boolean() }),
  trace: z.object({
    evaluated: z.array(
      z.object({
        assignmentId: z.string(),
        priority: z.number(),
        eligible: z.boolean(),
        reasons: z.array(z.string()),
      }),
    ),
    tie: z.object({ assignmentIds: z.array(z.string()), brokenBy: z.string() }).nullable(),
    abSkipped: z.string().optional(),
  }),
});
type Decision = z.infer<typeof Decision>;

/**
 * "Which script opens for this interaction?" — the author describes a test interaction with
 * fields (channel, queue, attached data) and reads the decision and every rejection as sentences.
 */
export function ResolverTester({
  campaigns,
  busy,
  resolve,
  scriptName,
  assignmentName,
}: {
  campaigns: readonly { value: string; label: string }[];
  busy: boolean;
  resolve: (body: Record<string, unknown>) => Promise<unknown>;
  scriptName: (scriptId: string) => string;
  assignmentName: (assignmentId: string) => string;
}) {
  const { t } = useTranslation();
  const [campaign, setCampaign] = useState(''),
    [channel, setChannel] = useState<string>('voice'),
    [locale, setLocale] = useState('tr'),
    [queue, setQueue] = useState(''),
    [segment, setSegment] = useState(''),
    [skills, setSkills] = useState(''),
    [attributes, setAttributes] = useState<Record<string, JsonValue>>({}),
    [decision, setDecision] = useState<Decision | null | undefined>(undefined);
  const skillList = skills
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);
  return (
    <article className="lc-card">
      <h2>{t('designer.lifecycle.resolver')}</h2>
      <p>{t('designer.lifecycle.resolverHelp')}</p>
      <Select
        label={t('designer.workspace.nav.campaigns')}
        value={campaign}
        onValueChange={setCampaign}
        options={campaigns}
      />
      <Select
        label={t('designer.preview.channel')}
        value={channel}
        onValueChange={setChannel}
        options={CHANNELS.map((value) => ({
          value,
          label: t(`designer.preview.channels.${value}`),
        }))}
      />
      <Select
        label={t('designer.lifecycle.facts.locale')}
        value={locale}
        onValueChange={setLocale}
        options={['tr', 'en'].map((value) => ({ value, label: t(`common.locale.${value}`) }))}
      />
      <Input
        label={t('designer.lifecycle.facts.queue')}
        value={queue}
        onChange={(event) => {
          setQueue(event.target.value);
        }}
      />
      <Input
        label={t('designer.lifecycle.facts.segment')}
        value={segment}
        onChange={(event) => {
          setSegment(event.target.value);
        }}
      />
      <Input
        label={t('designer.lifecycle.facts.skills')}
        hint={t('designer.lifecycle.resolution.skillsHint')}
        value={skills}
        onChange={(event) => {
          setSkills(event.target.value);
        }}
      />
      <KeyValueField
        label={t('designer.lifecycle.context')}
        hint={t('designer.lifecycle.resolution.attributesHint')}
        value={attributes}
        keyError={(key) =>
          ATTRIBUTE.test(key) ? undefined : t('designer.lifecycle.resolution.attributeInvalid')
        }
        change={setAttributes}
      />
      <Button
        loading={busy}
        disabled={!campaign}
        onClick={() => {
          void resolve({
            campaignId: campaign,
            channel,
            locale,
            ...(queue.trim() ? { queue: queue.trim() } : {}),
            ...(segment.trim() ? { segment: segment.trim() } : {}),
            ...(skillList.length ? { skills: skillList } : {}),
            attributes,
          }).then((value) => {
            if (value === undefined) return;
            const parsed = Decision.safeParse(value);
            setDecision(parsed.success ? parsed.data : null);
          });
        }}
      >
        {t('designer.lifecycle.resolveContext')}
      </Button>
      <div aria-live="polite">
        {decision === null && (
          <Alert tone="warning" title={t('designer.lifecycle.resolution.unreadable')} />
        )}
        {decision && (
          <DecisionView
            decision={decision}
            scriptName={scriptName}
            assignmentName={assignmentName}
          />
        )}
      </div>
    </article>
  );
}

function DecisionView({
  decision,
  scriptName,
  assignmentName,
}: {
  decision: Decision;
  scriptName: (scriptId: string) => string;
  assignmentName: (assignmentId: string) => string;
}) {
  const { t } = useTranslation();
  const resolution = (key: string, options?: Record<string, unknown>) =>
    t(`designer.lifecycle.resolution.${key}`, options ?? {});
  const hours = !decision.workingHours.configured
    ? 'none'
    : decision.workingHours.open
      ? 'open'
      : 'closed';
  return (
    <section className="lc-decision" aria-label={resolution('title')}>
      {decision.outcome === 'resolved' ? (
        <Alert
          tone="success"
          title={resolution('resolved', {
            script: decision.scriptId ? scriptName(decision.scriptId) : '—',
            version: decision.version?.semver ?? `v${String(decision.version?.number ?? '?')}`,
          })}
        />
      ) : (
        <Alert tone="warning" title={resolution('noMatch')}>
          {decision.reason &&
            resolution(`reasons.${decision.reason}`, { defaultValue: decision.reason })}
        </Alert>
      )}
      <ul className="lc-decision-facts">
        <li>{resolution(`workingHours.${hours}`)}</li>
        {decision.variant && (
          <li>
            {resolution('variant', {
              arm: decision.variant.key.toUpperCase(),
              bucket: decision.variant.bucket,
            })}
          </li>
        )}
        {decision.trace.abSkipped && (
          <li>
            {resolution(`abSkipped.${decision.trace.abSkipped}`, {
              defaultValue: decision.trace.abSkipped,
            })}
          </li>
        )}
        {decision.trace.tie && (
          <li>
            {resolution('tie', {
              by: resolution(`tieBy.${decision.trace.tie.brokenBy}`, {
                defaultValue: decision.trace.tie.brokenBy,
              }),
            })}
          </li>
        )}
      </ul>
      <h3>{resolution('evaluated')}</h3>
      {decision.trace.evaluated.length === 0 ? (
        <p>{resolution('noEvaluations')}</p>
      ) : (
        <ul className="lc-decision-list">
          {decision.trace.evaluated.map((row) => (
            <li key={row.assignmentId}>
              <Badge tone={row.eligible ? 'success' : 'neutral'}>
                {resolution(row.eligible ? 'eligible' : 'rejected')}
              </Badge>{' '}
              <strong>{assignmentName(row.assignmentId)}</strong> ·{' '}
              {t('designer.lifecycle.conflicts.priority', { priority: row.priority })}
              {row.reasons.length > 0 && (
                <ul>
                  {row.reasons.map((reason) => (
                    <li key={reason}>
                      {resolution(`rejects.${reason}`, { defaultValue: reason })}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
