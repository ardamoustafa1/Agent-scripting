import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  listSimulatorConnectors,
  SIM_ACTIONS,
  SIM_CHANNELS,
  simulate,
  simulateAction,
  SimulatorApiError,
  simulatorState,
  type NewSimulation,
  type SimAction,
  type SimChannel,
  type SimInteraction,
} from './simulator-api.js';

/** Actions that make sense in each status (buttons for others are not rendered). */
const ALLOWED: Record<SimInteraction['status'], readonly SimAction[]> = {
  alerting: ['connect', 'end'],
  connected: ['hold', 'customerMessage', 'transfer', 'wrapup', 'end'],
  held: ['resume', 'transfer', 'end'],
  transferred: ['connect', 'end'],
  wrapup: ['end'],
  ended: [],
};

const errorKey = (error: unknown) => {
  const code = error instanceof SimulatorApiError ? error.code : '';
  if (code === 'VERBIS_RESOURCE_NOT_FOUND') return 'admin.simulator.error.disabled';
  if (code === 'VERBIS_CONNECTOR_CONCURRENCY_LIMIT') return 'admin.simulator.error.capacity';
  if (['VERBIS_CONNECTOR_PAYLOAD_REJECTED', 'VERBIS_VALIDATION_FAILED'].includes(code))
    return 'admin.simulator.error.rejected';
  return 'admin.simulator.error.generic';
};

/**
 * Interaction Simulator (dev/demo): generates fake calls, chats, emails… on the Simulator
 * connector and drives them through their lifecycle, so agent-web launches real script sessions.
 */
export function SimulatorSection({ csrfToken }: { csrfToken: string }) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const connectors = useQuery({
    queryKey: ['sim-connectors'],
    queryFn: () => listSimulatorConnectors(csrfToken),
  });
  const connectorId = connectors.data?.[0];
  const state = useQuery({
    queryKey: ['sim-state', connectorId],
    queryFn: () => simulatorState(connectorId ?? '', csrfToken),
    enabled: connectorId !== undefined,
    refetchInterval: 3_000,
  });
  const [form, setForm] = useState<NewSimulation>({
    channel: 'chat',
    agentPlatformUserId: '',
    autoConnect: false,
  });
  const [message, setMessage] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['sim-state', connectorId] });
  const create = useMutation({
    mutationFn: (input: NewSimulation) => simulate(connectorId ?? '', input, csrfToken),
    onSuccess: refresh,
  });
  const act = useMutation({
    mutationFn: (input: { pid: string; action: SimAction }) =>
      simulateAction(
        connectorId ?? '',
        input.pid,
        {
          action: input.action,
          ...(input.action === 'customerMessage' && message !== '' ? { message } : {}),
          ...(input.action === 'transfer' ? { transferToPlatformUserId: transferTo } : {}),
        },
        csrfToken,
      ),
    onSuccess: refresh,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== ''),
      ) as unknown as NewSimulation,
    );
  };
  const text = (
    name: 'agentPlatformUserId' | 'agentEmail' | 'customerName' | 'subject' | 'message',
    required = false,
  ) => (
    <label className="vb-form-field" htmlFor={`${id}-${name}`}>
      {t(`admin.simulator.field.${name}`)}
      {name === 'message' ? (
        <textarea
          id={`${id}-${name}`}
          className="vb-input"
          rows={3}
          maxLength={8_000}
          value={form[name] ?? ''}
          onChange={(e) => {
            setForm({ ...form, [name]: e.target.value });
          }}
        />
      ) : (
        <input
          id={`${id}-${name}`}
          className="vb-input"
          type={name === 'agentEmail' ? 'email' : 'text'}
          required={required}
          maxLength={name === 'subject' ? 1_000 : 256}
          value={form[name] ?? ''}
          onChange={(e) => {
            setForm({ ...form, [name]: e.target.value });
          }}
        />
      )}
    </label>
  );

  return (
    <section className="vb-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('admin.simulator.title')}</h2>
      <p>{t('admin.simulator.description')}</p>
      {connectors.isSuccess && connectorId === undefined ? (
        <p role="status">{t('admin.simulator.noConnector')}</p>
      ) : null}
      {connectorId === undefined ? null : (
        <>
          <form className="vb-stack" onSubmit={submit} aria-labelledby={`${id}-new`}>
            <h3 id={`${id}-new`}>{t('admin.simulator.newTitle')}</h3>
            <label className="vb-form-field" htmlFor={`${id}-channel`}>
              {t('admin.simulator.field.channel')}
              <select
                id={`${id}-channel`}
                className="vb-input"
                value={form.channel}
                onChange={(e) => {
                  setForm({ ...form, channel: e.target.value as SimChannel });
                }}
              >
                {SIM_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {t(`admin.simulator.channel.${channel}`)}
                  </option>
                ))}
              </select>
            </label>
            {text('agentPlatformUserId', true)}
            {text('agentEmail')}
            {text('customerName')}
            {form.channel === 'email' ? text('subject') : null}
            {text('message')}
            <label className="vb-form-field" htmlFor={`${id}-auto`}>
              <input
                id={`${id}-auto`}
                type="checkbox"
                checked={form.autoConnect}
                onChange={(e) => {
                  setForm({ ...form, autoConnect: e.target.checked });
                }}
              />
              {t('admin.simulator.field.autoConnect')}
            </label>
            <button className="vb-button" type="submit" disabled={create.isPending}>
              {t('admin.simulator.create')}
            </button>
            {create.isError ? (
              <p className="vb-alert" role="alert">
                {t(errorKey(create.error))}
              </p>
            ) : null}
          </form>

          <div className="vb-stack">
            <h3>{t('admin.simulator.activeTitle')}</h3>
            <label className="vb-form-field" htmlFor={`${id}-say`}>
              {t('admin.simulator.field.customerMessage')}
              <input
                id={`${id}-say`}
                className="vb-input"
                maxLength={8_000}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
              />
            </label>
            <label className="vb-form-field" htmlFor={`${id}-transfer`}>
              {t('admin.simulator.field.transferTo')}
              <input
                id={`${id}-transfer`}
                className="vb-input"
                maxLength={256}
                value={transferTo}
                onChange={(e) => {
                  setTransferTo(e.target.value);
                }}
              />
            </label>
            {state.data?.interactions.length === 0 ? <p>{t('admin.simulator.empty')}</p> : null}
            <table>
              <caption>{t('admin.simulator.activeTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('admin.simulator.column.channel')}</th>
                  <th scope="col">{t('admin.simulator.column.agent')}</th>
                  <th scope="col">{t('admin.simulator.column.status')}</th>
                  <th scope="col">{t('admin.simulator.column.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {state.data?.interactions.map((interaction) => (
                  <tr key={interaction.platformInteractionId}>
                    <td>{t(`admin.simulator.channel.${interaction.channel}`)}</td>
                    <td>{interaction.agentPlatformUserId}</td>
                    <td>{t(`admin.simulator.status.${interaction.status}`)}</td>
                    <td>
                      {SIM_ACTIONS.filter((action) =>
                        ALLOWED[interaction.status].includes(action),
                      ).map((action) => (
                        <button
                          key={action}
                          className="vb-button"
                          data-variant="secondary"
                          type="button"
                          disabled={act.isPending || (action === 'transfer' && transferTo === '')}
                          aria-label={t('admin.simulator.actionFor', {
                            action: t(`admin.simulator.action.${action}`),
                            channel: t(`admin.simulator.channel.${interaction.channel}`),
                            agent: interaction.agentPlatformUserId,
                          })}
                          onClick={() => {
                            act.mutate({ pid: interaction.platformInteractionId, action });
                          }}
                        >
                          {t(`admin.simulator.action.${action}`)}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {act.isError ? (
              <p className="vb-alert" role="alert">
                {t(errorKey(act.error))}
              </p>
            ) : null}
          </div>

          <div className="vb-stack">
            <h3>{t('admin.simulator.commandsTitle')}</h3>
            {state.data?.commands.length === 0 ? <p>{t('admin.simulator.noCommands')}</p> : null}
            <ul>
              {state.data?.commands.map((command) => (
                <li key={command.commandId}>
                  {t('admin.simulator.commandLine', {
                    command: command.command,
                    interaction: command.platformInteractionId,
                    at: command.at,
                  })}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
