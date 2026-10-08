import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ScriptDocument, TestScenario } from '@verbis/script-schema';
import { Alert, Badge, Button, Progress } from '@verbis/ui';

import { editorRegistry, useEditor, type EditorStore } from '../editor/store.js';

import {
  analyzeCoverage,
  generateForBranch,
  type BranchGap,
  type CoverageReport,
} from './coverage.js';

const SCENARIO_LIMIT = 20;
export interface CoverageTrace {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

/** Flow node as a designer reads it: its page name, data source or kind. */
function nodeLabel(
  document: ScriptDocument,
  flowId: string,
  nodeId: string,
  typeName: (type: string) => string,
): string {
  const flow = [document.flow, ...document.subflows].find((f) => f.id === flowId);
  const node = flow?.nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;
  if (node.type === 'page')
    return document.pages.find((page) => page.id === node.page)?.name ?? node.page;
  if (node.type === 'dataSource') return node.dataSource;
  return typeName(node.type);
}

/**
 * Branch coverage of the saved scenarios (DIFFERENTIATORS B3): what is untested, painted on the
 * flow, with one click to search for a scenario that opens a missing branch.
 */
export function CoveragePanel({
  store,
  editable,
  onTrace,
}: {
  store: EditorStore;
  editable: boolean;
  onTrace: (trace: CoverageTrace | null) => void;
}) {
  const { t } = useTranslation();
  const state = useEditor(store);
  const typeName = (type: string) => t(`designer.flow.types.${type}`, { defaultValue: type });
  const [report, setReport] = useState<CoverageReport | null>(null),
    [running, setRunning] = useState(false),
    [failed, setFailed] = useState(false),
    [working, setWorking] = useState<string | null>(null),
    [found, setFound] = useState<Record<string, TestScenario | 'none'>>({});
  const scenarios = state.document.testScenarios ?? [];
  const key = (gap: BranchGap) => `${gap.flowId}:${gap.edgeId}`;

  const measure = async (document: ScriptDocument) => {
    setRunning(true);
    setFailed(false);
    try {
      const next = await analyzeCoverage(document, editorRegistry);
      setReport(next);
      // The flow view shows the main flow; qualify-strip its ids for painting.
      const prefix = `${document.flow.id}:`;
      const strip = (keys: ReadonlySet<string>) =>
        new Set([...keys].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
      onTrace({ nodes: strip(next.nodes), edges: strip(next.edges) });
    } catch {
      setFailed(true);
      onTrace(null);
    } finally {
      setRunning(false);
    }
  };

  const generate = async (gap: BranchGap) => {
    if (!report) return;
    setWorking(key(gap));
    try {
      const from = nodeLabel(state.document, gap.flowId, gap.from, typeName);
      const to = nodeLabel(state.document, gap.flowId, gap.to, typeName);
      const scenario = await generateForBranch(
        state.document,
        editorRegistry,
        gap,
        report,
        t('designer.coverage.generatedName', { from, to }),
      );
      setFound((previous) => ({ ...previous, [key(gap)]: scenario ?? 'none' }));
    } finally {
      setWorking(null);
    }
  };

  const add = (gap: BranchGap, scenario: TestScenario) => {
    store.edit((document) => {
      document.testScenarios = [...(document.testScenarios ?? []), scenario];
    });
    setFound((previous) => {
      const next = { ...previous };
      Reflect.deleteProperty(next, key(gap));
      return next;
    });
    void measure(store.getSnapshot().document);
  };

  const failing = report?.results.filter((result) => !result.passed).length ?? 0;
  return (
    <div className="pv-panel pv-coverage">
      <p>{t('designer.coverage.help')}</p>
      <Button
        loading={running}
        onClick={() => {
          void measure(state.document);
        }}
      >
        {t(report ? 'designer.coverage.rerun' : 'designer.coverage.run')}
      </Button>
      {failed && <Alert tone="danger" title={t('designer.coverage.failed')} />}
      {report && (
        <section aria-live="polite" className="pv-coverage-summary">
          {report.percent === null ? (
            <p>{t('designer.coverage.noEdges')}</p>
          ) : (
            <>
              <Progress label={t('designer.coverage.meter')} value={report.percent} />
              <p>
                {t('designer.coverage.summary', {
                  percent: report.percent,
                  covered: report.coveredEdges,
                  total: report.totalEdges,
                })}
              </p>
            </>
          )}
          {scenarios.length === 0 && <p>{t('designer.coverage.noScenarios')}</p>}
          {failing > 0 && (
            <Alert tone="warning" title={t('designer.coverage.failing', { count: failing })} />
          )}
        </section>
      )}
      {report && report.uncovered.length > 0 && (
        <section aria-labelledby="pv-coverage-gaps">
          <h3 id="pv-coverage-gaps">{t('designer.coverage.gaps')}</h3>
          <ul className="pv-coverage-gaps">
            {report.uncovered.map((gap) => {
              const result = found[key(gap)];
              const from = nodeLabel(state.document, gap.flowId, gap.from, typeName);
              const to = nodeLabel(state.document, gap.flowId, gap.to, typeName);
              return (
                <li key={key(gap)}>
                  <span className="pv-coverage-branch">
                    {t('designer.coverage.branch', { from, to })}
                  </span>
                  <Badge tone={gap.kind === 'error' ? 'warning' : 'neutral'}>
                    {t(`designer.coverage.kinds.${gap.kind}`)}
                  </Badge>
                  {result === undefined && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={working === key(gap)}
                      disabled={working !== null && working !== key(gap)}
                      aria-label={t('designer.coverage.generateFor', { from, to })}
                      onClick={() => {
                        void generate(gap);
                      }}
                    >
                      {t('designer.coverage.generate')}
                    </Button>
                  )}
                  {result === 'none' && <p>{t('designer.coverage.notFound')}</p>}
                  {result !== undefined && result !== 'none' && (
                    <div className="pv-coverage-found">
                      <p>
                        {t('designer.coverage.found', {
                          values:
                            Object.entries(result.context.variables)
                              .map(([name, value]) => `${name} = ${JSON.stringify(value)}`)
                              .join(', ') || t('designer.coverage.mockChange'),
                        })}
                      </p>
                      {editable ? (
                        <Button
                          size="sm"
                          disabled={scenarios.length >= SCENARIO_LIMIT}
                          onClick={() => {
                            add(gap, result);
                          }}
                        >
                          {t('designer.coverage.add')}
                        </Button>
                      ) : (
                        <p>{t('designer.coverage.readOnly')}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {report?.percent === 100 && (
        <p className="pv-coverage-complete">{t('designer.coverage.complete')}</p>
      )}
    </div>
  );
}
