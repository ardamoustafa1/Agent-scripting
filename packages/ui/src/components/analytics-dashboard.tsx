import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChartNoAxesCombined,
  CircleCheck,
  Clock3,
  Download,
  Mail,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Sankey,
} from 'recharts';

import type {
  AnalyticsDashboard as Dashboard,
  AnalyticsFilter,
  AnalyticsSchedule,
} from '@verbis/shared-types';

import { Button } from './button.js';
import { Alert } from './feedback.js';

export function defaultAnalyticsFilter(): AnalyticsFilter {
  const now = new Date();
  return {
    from: new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}
export interface AnalyticsDashboardProps {
  data?: Dashboard | undefined;
  filter: AnalyticsFilter;
  onFilter: (filter: AnalyticsFilter) => void;
  loading: boolean;
  error?: boolean;
  onRetry: () => void;
  onExport?: (format: 'csv' | 'xlsx') => Promise<void>;
  onSchedule?: (schedule: AnalyticsSchedule) => Promise<void>;
  schedules?: { id: string; nextRunAt: string }[] | undefined;
  onDeleteSchedule?: (id: string) => Promise<void>;
}
function SankeyView({ paths }: { paths: Dashboard['paths'] }) {
  // Stage copies turn revisits and cyclic paths into a DAG; never feed cycles to Sankey layout.
  const links = paths.slice(0, 24);
  const names = [...new Set(links.flatMap((l) => ['from:' + l.source, 'to:' + l.target]))];
  return links.length ? (
    <ResponsiveContainer width="100%" height={260}>
      <Sankey
        data={{
          nodes: names.map((name) => ({ name: name.replace(/^(from|to):/, '') })),
          links: links.map((l) => ({
            source: names.indexOf('from:' + l.source),
            target: names.indexOf('to:' + l.target),
            value: l.count,
          })),
        }}
        node={{ fill: 'var(--vb-color-primary)' }}
        link={{ stroke: 'var(--vb-color-primary)', strokeOpacity: 0.22 }}
        margin={{ top: 20, left: 20, right: 20, bottom: 20 }}
      >
        <Tooltip />
      </Sankey>
    </ResponsiveContainer>
  ) : null;
}
export function AnalyticsDashboard({
  data,
  filter,
  onFilter,
  loading,
  error,
  onRetry,
  onExport,
  onSchedule,
  schedules,
  onDeleteSchedule,
}: AnalyticsDashboardProps) {
  const { t, i18n } = useTranslation(),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [confirmation, setConfirmation] = useState(''),
    [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly'),
    [hour, setHour] = useState(8),
    [recipients, setRecipients] = useState('');
  const number = (n: number | null) =>
      n === null
        ? '—'
        : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(n),
    percent = (n: number | null) =>
      n === null
        ? '—'
        : new Intl.NumberFormat(i18n.language, {
            style: 'percent',
            maximumFractionDigits: 1,
          }).format(n);
  const operation = async (run: () => Promise<void>, message = '') => {
    setBusy(true);
    setFailed(false);
    setConfirmation('');
    try {
      await run();
      setConfirmation(message);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const set = (key: keyof AnalyticsFilter, value: string) => {
    const next = { ...filter };
    if (value) Reflect.set(next, key, value);
    else Reflect.deleteProperty(next, key);
    onFilter(next);
  };
  const chart = (rows: { key: string; count: number }[], label: string) => (
    <section className="vb-analytics-card">
      <h2>{label}</h2>
      <div aria-hidden>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart accessibilityLayer={false} data={rows.slice(0, 30)}>
            <CartesianGrid stroke="var(--vb-color-border)" vertical={false} />
            <XAxis dataKey="key" tick={{ fill: 'var(--vb-color-text-muted)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--vb-color-text-muted)' }} />
            <Tooltip />
            <Bar
              isAnimationActive={false}
              dataKey="count"
              fill="var(--vb-color-primary)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary>{t('analytics.table')}</summary>
        <table>
          <thead>
            <tr>
              <th>{t('analytics.dimension')}</th>
              <th>{t('analytics.count')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.key}</th>
                <td>{number(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
  const metricsTable = (rows: Dashboard['scripts'], title: string) => (
    <section className="vb-analytics-card">
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('analytics.dimension')}</th>
            <th>{t('analytics.sessions')}</th>
            <th>{t('analytics.completion')}</th>
            <th>{t('analytics.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.key}</th>
              <td>{number(row.sessions)}</td>
              <td>{percent(row.completionRate)}</td>
              <td>
                {number(row.meanDurationMs === null ? null : row.meanDurationMs / 1000)}{' '}
                {t('analytics.seconds')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
  const selectRange = (days: number) => {
    const current = defaultAnalyticsFilter();
    onFilter({
      ...filter,
      from: new Date(new Date(current.to).getTime() - (days - 1) * 86400000)
        .toISOString()
        .slice(0, 10),
      to: current.to,
    });
  };
  const hasDimensions = [filter.campaignId, filter.teamId, filter.channel].some(Boolean);
  const durationMs = data?.meanDurationMs ?? null;
  const metrics = [
    { label: 'sessions', hint: 'sessionsHint', value: number(data?.sessions ?? null), Icon: Users },
    {
      label: 'completion',
      hint: 'completionHint',
      value: percent(data && data.sessions > 0 ? data.completionRate : null),
      Icon: CircleCheck,
    },
    {
      label: 'duration',
      hint: 'durationHint',
      value: durationMs === null ? '—' : `${number(durationMs / 1000)} ${t('analytics.seconds')}`,
      Icon: Clock3,
    },
    {
      label: 'compliance',
      hint: 'complianceHint',
      value: percent(data?.compliance.rate ?? null),
      Icon: ShieldCheck,
    },
  ];
  const schedulePanel = onSchedule ? (
    <section className="vb-analytics-card vb-analytics-schedule">
      <header className="vb-analytics-schedule-heading vb-brand-surface">
        <div className="vb-analytics-panel-icon" aria-hidden>
          <Mail size={20} />
        </div>
        <h2>{t('analytics.schedule')}</h2>
        <p className="vb-analytics-help">{t('analytics.scheduleHint')}</p>
      </header>
      <form
        className="vb-analytics-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void operation(
            () =>
              onSchedule({
                filter,
                frequency,
                hourUtc: hour,
                enabled: true,
                recipientUserIds: recipients
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              }),
            'analytics.scheduleSaved',
          );
        }}
      >
        <label>
          {t('analytics.frequency')}
          <select
            value={frequency}
            onChange={(e) => {
              setFrequency(e.target.value === 'daily' ? 'daily' : 'weekly');
            }}
          >
            <option value="daily">{t('analytics.daily')}</option>
            <option value="weekly">{t('analytics.weekly')}</option>
          </select>
        </label>
        <label>
          {t('analytics.hour')}
          <input
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(e) => {
              setHour(Number(e.target.value));
            }}
          />
        </label>
        <label>
          {t('analytics.recipients')}
          <input
            required
            value={recipients}
            onChange={(e) => {
              setRecipients(e.target.value);
            }}
            placeholder={t('analytics.recipientsPlaceholder')}
          />
        </label>
        <p className="vb-analytics-help">{t('analytics.recipientsHint')}</p>
        <Button type="submit" disabled={busy} endIcon={<ArrowRight size={16} aria-hidden />}>
          {t('analytics.save')}
        </Button>
      </form>
      <p className="vb-analytics-help vb-analytics-timezone">
        <Clock3 size={14} aria-hidden />
        {t('analytics.deliveryTimezone')}
      </p>
      {confirmation && (
        <p className="vb-analytics-confirmation" role="status">
          <CircleCheck size={16} aria-hidden />
          {t(confirmation)}
        </p>
      )}
      {schedules?.map((s) => (
        <div className="vb-analytics-delivery" key={s.id}>
          <span className="vb-analytics-help">{t('analytics.nextDelivery')}</span>
          <p>
            {s.nextRunAt}{' '}
            {onDeleteSchedule && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void operation(() => onDeleteSchedule(s.id), 'analytics.scheduleRemoved');
                }}
              >
                {t('analytics.remove')}
              </Button>
            )}
          </p>
        </div>
      ))}
    </section>
  ) : null;
  return (
    <div className="vb-analytics">
      <header className="vb-analytics-heading">
        <div>
          <p className="vb-analytics-eyebrow">{t('analytics.eyebrow')}</p>
          <h1>{t('analytics.title')}</h1>
          <p>{t('analytics.subtitle')}</p>
        </div>
        <div className="vb-analytics-actions">
          {onExport &&
            (['csv', 'xlsx'] as const).map((format) => (
              <Button
                key={format}
                variant={format === 'csv' ? 'primary' : 'secondary'}
                startIcon={<Download size={14} aria-hidden />}
                disabled={busy || !data || loading}
                onClick={() => {
                  void operation(() => onExport(format));
                }}
              >
                {format.toUpperCase()}
              </Button>
            ))}
        </div>
      </header>
      <section className="vb-analytics-filter-panel" aria-label={t('analytics.filters')}>
        <div className="vb-analytics-filter-heading">
          <div>
            <h2>
              <SlidersHorizontal size={16} aria-hidden />
              {t('analytics.filters')}
            </h2>
            <p>{t('analytics.filtersHint')}</p>
          </div>
          <div className="vb-analytics-presets">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                selectRange(7);
              }}
            >
              {t('analytics.lastSeven')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                selectRange(30);
              }}
            >
              {t('analytics.lastThirty')}
            </Button>
          </div>
        </div>
        <form
          className="vb-analytics-filters"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          {(['from', 'to', 'campaignId', 'channel', 'teamId'] as const).map((key) => (
            <label key={key}>
              {t('analytics.' + key)}
              {key === 'channel' ? (
                <select
                  value={filter.channel ?? ''}
                  onChange={(e) => {
                    set(key, e.target.value);
                  }}
                >
                  <option value="">{t('analytics.all')}</option>
                  {[
                    'voice',
                    'chat',
                    'email',
                    'video',
                    'social',
                    'messaging',
                    'sms',
                    'whatsapp',
                    'callback',
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={key === 'from' || key === 'to' ? 'date' : 'text'}
                  value={filter[key] ?? ''}
                  onChange={(e) => {
                    set(key, e.target.value);
                  }}
                  placeholder={
                    key === 'campaignId'
                      ? t('analytics.campaignPlaceholder')
                      : key === 'teamId'
                        ? t('analytics.teamPlaceholder')
                        : undefined
                  }
                />
              )}
            </label>
          ))}
        </form>
        <div className="vb-analytics-filter-note">
          <span>{t('analytics.scopeHelp')}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasDimensions}
            startIcon={<X size={14} aria-hidden />}
            onClick={() => {
              onFilter({ from: filter.from, to: filter.to });
            }}
          >
            {t('analytics.clearFilters')}
          </Button>
        </div>
      </section>
      <div className="vb-analytics-kpis" aria-label={t('analytics.overview')}>
        {metrics.map(({ label, hint, value, Icon }) => (
          <section className="vb-analytics-card vb-analytics-metric" key={label}>
            <div>
              <span>{t(`analytics.${label}`)}</span>
              <Icon size={18} aria-hidden />
            </div>
            <strong>{loading || error ? '—' : value}</strong>
            <p>{t(`analytics.${hint}`)}</p>
          </section>
        ))}
      </div>
      <div className="vb-analytics-workspace" data-schedule={Boolean(onSchedule)}>
        <div className="vb-analytics-results">
          {failed && <Alert tone="danger" title={t('analytics.operationFailed')} />}
          {error ? (
            <Alert tone="danger" title={t('analytics.error')}>
              <Button onClick={onRetry}>{t('analytics.retry')}</Button>
            </Alert>
          ) : loading ? (
            <div className="vb-analytics-empty">
              <Activity size={40} aria-hidden />
              <p role="status">{t('analytics.loading')}</p>
            </div>
          ) : !data || data.sessions === 0 ? (
            <section className="vb-analytics-empty">
              <div className="vb-analytics-empty-art" aria-hidden>
                <ChartNoAxesCombined size={40} />
                <span />
                <span />
                <span />
              </div>
              <div role="status">
                <h2>{t('analytics.empty')}</h2>
              </div>
              <p>{t('analytics.emptyHint')}</p>
              <div className="vb-analytics-empty-scope">
                <CalendarDays size={14} aria-hidden />
                <span>
                  {filter.from} {t('analytics.arrow')} {filter.to}
                </span>
              </div>
            </section>
          ) : (
            <>
              <div className="vb-analytics-grid">
                {metricsTable(data.scripts, t('analytics.scripts'))}
                {data.agents.length > 0 &&
                  metricsTable(
                    data.agents.map((a) => ({ ...a, key: a.key.slice(0, 12) })),
                    t('analytics.agents'),
                  )}
                {metricsTable(
                  data.variants.map((v) => ({ ...v, key: v.experimentId + ':' + v.key })),
                  t('analytics.ab'),
                )}
                {chart(
                  data.scripts.map((s) => ({ key: s.key, count: s.sessions })),
                  t('analytics.scripts'),
                )}
                {chart(data.outcomes, t('analytics.outcomes'))}
                <section className="vb-analytics-card">
                  <h2>{t('analytics.paths')}</h2>
                  <div aria-hidden>
                    <SankeyView paths={data.paths} />
                  </div>
                  <details>
                    <summary>{t('analytics.table')}</summary>
                    <table>
                      <tbody>
                        {data.paths.map((p) => (
                          <tr key={p.source + '>' + p.target}>
                            <th scope="row">
                              {p.source} {t('analytics.arrow')} {p.target}
                            </th>
                            <td>{p.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </section>
                <section className="vb-analytics-card">
                  <h2>{t('analytics.pages')}</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('analytics.dimension')}</th>
                        <th>{t('analytics.dwell')}</th>
                        <th>{t('analytics.dropOff')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pages.map((p) => (
                        <tr key={p.key}>
                          <th scope="row">{p.key}</th>
                          <td>
                            {number(p.meanDwellMs === null ? null : p.meanDwellMs / 1000)}{' '}
                            {t('analytics.seconds')}
                          </td>
                          <td>{percent(p.dropOffRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="vb-analytics-card">
                  <h2>{t('analytics.sources')}</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('analytics.dimension')}</th>
                        <th>{t('analytics.milliseconds')}</th>
                        <th>{t('analytics.errors')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources.map((s) => (
                        <tr key={s.key}>
                          <th scope="row">{s.key}</th>
                          <td>{number(s.meanLatencyMs)}</td>
                          <td>{percent(s.errorRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="vb-analytics-card">
                  <h2>{t('analytics.ab')}</h2>
                  <p>{t('analytics.abHint')}</p>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('analytics.dimension')}</th>
                        <th>{t('analytics.completion')}</th>
                        <th>{t('analytics.pValue')}</th>
                        <th>{t('analytics.significant')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.comparisons.map((c) => (
                        <tr key={c.experimentId + c.a + c.b}>
                          <th scope="row">
                            {c.a} / {c.b}
                          </th>
                          <td>{percent(c.difference)}</td>
                          <td>{number(c.pValue)}</td>
                          <td>
                            {t(
                              c.reason === 'insufficient'
                                ? 'analytics.insufficient'
                                : c.significant
                                  ? 'analytics.yes'
                                  : 'analytics.no',
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                {data.agents.length > 0 &&
                  chart(
                    data.agents.map((a) => ({ key: a.key.slice(0, 12), count: a.sessions })),
                    t('analytics.agents'),
                  )}
              </div>
              <section className="vb-analytics-card">
                <h2>{t('analytics.supervisor')}</h2>
                <p role="status">
                  {t('analytics.liveHint')} · {number(data.active.length)} {t('analytics.active')}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>{t('analytics.campaignId')}</th>
                      <th>{t('analytics.active')}</th>
                      <th>{t('analytics.completed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.liveCampaigns.map((c) => (
                      <tr key={c.key}>
                        <th scope="row">{c.key}</th>
                        <td>{c.active}</td>
                        <td>{c.completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <details>
                  <summary>{t('analytics.sessions')}</summary>
                  <table>
                    <tbody>
                      {data.active.map((s) => (
                        <tr key={s.sessionId}>
                          <th scope="row">{s.sessionId}</th>
                          <td>{s.agent?.slice(0, 12) ?? '—'}</td>
                          <td>{s.state}</td>
                          <td>{s.since}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>
              <p className="vb-analytics-footnote">
                {t('analytics.cohort')} · {new Date(data.generatedAt).toLocaleString(i18n.language)}
              </p>
            </>
          )}
        </div>
        {schedulePanel}
      </div>
    </div>
  );
}
