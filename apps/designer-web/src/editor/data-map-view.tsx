import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  dataMap,
  newDataFlows,
  type DataDestination,
  type DataMapEntry,
  type DataOrigin,
  type ScriptDocument,
} from '@verbis/script-schema';

/** The same exposure rules as validation: card data anywhere, personal data in logs or analytics. */
export function riskyDestination(entry: DataMapEntry, destination: DataDestination): boolean {
  if (entry.classification === 'pci') return true;
  return destination.kind === 'log' || destination.kind === 'analytics';
}

function destinationKey(destination: DataDestination) {
  return destination.kind === 'integration' ? `integration:${destination.id}` : destination.kind;
}

/**
 * Data map (DIFFERENTIATORS G3): every PII/PCI variable with where it comes from, where it goes
 * and whether it is stored. `baseline` highlights flows a release adds.
 */
export function DataMapView({
  document,
  baseline,
}: {
  document: ScriptDocument;
  baseline?: ScriptDocument | undefined;
}) {
  const { t } = useTranslation();
  const entries = useMemo(() => dataMap(document), [document]);
  const added = useMemo(
    () =>
      baseline
        ? new Set(
            newDataFlows(dataMap(baseline), entries).map(
              (flow) => `${flow.variable}|${destinationKey(flow.destination)}`,
            ),
          )
        : new Set<string>(),
    [baseline, entries],
  );
  const origin = (value: DataOrigin) =>
    value.kind === 'context'
      ? t('designer.dataMap.origins.context', { path: value.path })
      : value.kind === 'agentInput'
        ? t('designer.dataMap.origins.agentInput', { node: value.node })
        : value.kind === 'dataSource'
          ? t('designer.dataMap.origins.dataSource', { id: value.id })
          : t('designer.dataMap.origins.script');
  const destination = (value: DataDestination) =>
    value.kind === 'integration'
      ? t('designer.dataMap.destinations.integration', { id: value.id })
      : t(`designer.dataMap.destinations.${value.kind}`);

  if (entries.length === 0)
    return <p className="ed-data-map-empty">{t('designer.dataMap.empty')}</p>;
  return (
    <div className="ed-data-map">
      <table>
        <caption className="vb-sr-only">{t('designer.dataMap.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('designer.dataMap.variable')}</th>
            <th scope="col">{t('designer.dataMap.from')}</th>
            <th scope="col">{t('designer.dataMap.to')}</th>
            <th scope="col">{t('designer.dataMap.stored')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const unique = [
              ...new Map(entry.destinations.map((d) => [destinationKey(d), d])).values(),
            ];
            return (
              <tr key={entry.variable}>
                <th scope="row">
                  <code>{entry.variable}</code>{' '}
                  <span className="ed-data-class" data-class={entry.classification}>
                    {t(`designer.dataMap.classes.${entry.classification}`)}
                  </span>
                </th>
                <td>
                  {entry.origins.length === 0
                    ? t('designer.dataMap.none')
                    : entry.origins.map(origin).join(' · ')}
                </td>
                <td>
                  {unique.length === 0 ? (
                    t('designer.dataMap.nowhere')
                  ) : (
                    <ul className="ed-data-flows">
                      {unique.map((value) => {
                        const risky = riskyDestination(entry, value);
                        const isNew = added.has(`${entry.variable}|${destinationKey(value)}`);
                        return (
                          <li key={destinationKey(value)} data-risky={risky} data-new={isNew}>
                            {risky && <TriangleAlert size={13} aria-hidden />}
                            <span>{destination(value)}</span>
                            {risky && (
                              <span className="vb-sr-only">{t('designer.dataMap.risky')}</span>
                            )}
                            {isNew && (
                              <span className="ed-data-new">{t('designer.dataMap.new')}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
                <td>{t(entry.persisted ? 'designer.dataMap.yes' : 'designer.dataMap.no')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
