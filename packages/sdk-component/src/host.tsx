import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  Box,
  type ComponentDefinition,
  type ComponentRegistry,
  type RendererProps,
} from '@verbis/core-runtime';
import { JsonValueSchema } from '@verbis/script-schema';
import { Alert } from '@verbis/ui';

import { PluginBridge } from './bridge.js';
import { checkApproval, loadBundle, trustedSandboxDocument } from './bundle.js';
import { PluginManifestSchema, type PluginManifest, type TenantApproval } from './protocol.js';

export interface PluginDescriptor {
  manifest: PluginManifest;
  propsSchema: z.ZodType<Record<string, unknown>>;
  defaults: Record<string, z.infer<typeof JsonValueSchema>>;
  designerMeta: ComponentDefinition['designerMeta'];
}
export interface TenantComponentCatalog {
  resolve(type: string, version: string, signal: AbortSignal): Promise<unknown>;
}
/** Catalog resolves using the authenticated session tenant; script JSON never chooses tenant or URL. */
export class ComponentPluginHost {
  private approvals = new Map<string, TenantApproval>();
  private listeners = new Set<() => void>();
  constructor(
    readonly tenantId: string,
    private catalog: TenantComponentCatalog,
    private now: () => number = Date.now,
  ) {}
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  approval = (type: string): TenantApproval | undefined => this.approvals.get(type);
  async refresh(
    descriptor: PluginDescriptor,
    signal = new AbortController().signal,
  ): Promise<void> {
    try {
      const raw = await this.catalog.resolve(
        descriptor.manifest.type,
        descriptor.manifest.version,
        signal,
      );
      this.approvals.set(
        descriptor.manifest.type,
        checkApproval(raw, this.tenantId, descriptor.manifest, this.now()),
      );
    } catch (error) {
      this.approvals.delete(descriptor.manifest.type);
      throw error;
    } finally {
      for (const listener of this.listeners) listener();
    }
  }
  async registerComponent(
    registry: ComponentRegistry,
    descriptor: PluginDescriptor,
    signal = new AbortController().signal,
  ): Promise<void> {
    descriptor = { ...descriptor, manifest: PluginManifestSchema.parse(descriptor.manifest) };
    descriptor.propsSchema.parse(descriptor.defaults);
    await this.refresh(descriptor, signal);
    const host = { subscribe: this.subscribe, approval: this.approval, now: this.now };
    function Sandbox(component: RendererProps) {
      const { t } = useTranslation(),
        iframe = useRef<HTMLIFrameElement>(null),
        channel = useRef<MessageChannel | null>(null),
        bridge = useRef<PluginBridge | null>(null),
        connected = useRef(false);
      const [source, setSource] = useState(''),
        [failed, setFailed] = useState(false),
        [height, setHeight] = useState(180);
      const approval = useSyncExternalStore(
        host.subscribe,
        () => host.approval(descriptor.manifest.type),
        () => undefined,
      );
      const latest = useRef(component);
      latest.current = component;
      useEffect(() => {
        const controller = new AbortController();
        connected.current = false;
        setSource('');
        setFailed(false);
        if (!approval) {
          setFailed(true);
          return () => {
            controller.abort();
          };
        }
        const expire = setTimeout(
          () => {
            controller.abort();
            channel.current?.port1.close();
            connected.current = false;
            setSource('');
            setFailed(true);
          },
          Math.max(0, approval.expiresAt - host.now()),
        );
        void loadBundle(approval, controller.signal)
          .then((bundle) => {
            if (!controller.signal.aborted) setSource(trustedSandboxDocument(bundle));
          })
          .catch(() => {
            if (!controller.signal.aborted) setFailed(true);
          });
        return () => {
          controller.abort();
          clearTimeout(expire);
          channel.current?.port1.close();
          channel.current?.port2.close();
          bridge.current = null;
        };
      }, [approval]);
      useEffect(() => {
        bridge.current?.update(component);
        if (channel.current && bridge.current) {
          try {
            channel.current.port1.postMessage({
              protocol: 1,
              op: 'state',
              props: bridge.current.publicProps(),
              locale: component.runtime.store.locale.startsWith('en') ? 'en' : 'tr',
              enabled: component.enabled,
            });
          } catch {
            setFailed(true);
            channel.current.port1.close();
          }
        }
      }, [component]);
      const connect = () => {
        channel.current?.port1.close();
        const current = iframe.current?.contentWindow;
        if (!current || !approval) return;
        if (connected.current) {
          setFailed(true);
          return;
        }
        connected.current = true;
        const pair = new MessageChannel(),
          firewall = new PluginBridge(
            descriptor.manifest,
            latest.current,
            descriptor.propsSchema,
            setHeight,
            host.now,
          );
        channel.current = pair;
        bridge.current = firewall;
        pair.port1.onmessage = (event) => {
          void firewall
            .handle(event.data as unknown)
            .then((seq) => {
              pair.port1.postMessage({ protocol: 1, op: 'reply', seq, ok: true });
            })
            .catch(() => {
              setFailed(true);
              pair.port1.close();
            });
        };
        pair.port1.start();
        try {
          const props = z.record(z.string(), JsonValueSchema).parse(firewall.publicProps());
          current.postMessage(
            {
              protocol: 1,
              op: 'init',
              props,
              locale: latest.current.runtime.store.locale.startsWith('en') ? 'en' : 'tr',
              enabled: latest.current.enabled,
            },
            '*',
            [pair.port2],
          );
        } catch {
          setFailed(true);
          pair.port1.close();
        }
      };
      return (
        <Box {...component} props={{ gap: 'sm' }}>
          {failed ? (
            <Alert tone="danger" title={t('components.pluginUnavailable')} />
          ) : source ? (
            <iframe
              ref={iframe}
              title={
                typeof component.props['labelKey'] === 'string'
                  ? component.runtime.message(component.props['labelKey'])
                  : descriptor.manifest.type
              }
              srcDoc={source}
              sandbox="allow-scripts"
              allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'; clipboard-write 'none'"
              referrerPolicy="no-referrer"
              onLoad={connect}
              height={height}
              className="vc-plugin-frame"
            />
          ) : (
            <Alert title={t('runtime.loading')} />
          )}
        </Box>
      );
    }
    registry.register({
      type: descriptor.manifest.type,
      renderer: Sandbox,
      propsSchema: descriptor.propsSchema,
      defaults: descriptor.defaults,
      designerMeta: descriptor.designerMeta,
      events: descriptor.manifest.permissions.events,
      bindableProps: descriptor.manifest.permissions.props,
      plugin: { version: descriptor.manifest.version, integrity: descriptor.manifest.integrity },
    });
  }
}
export async function registerComponent(
  host: ComponentPluginHost,
  registry: ComponentRegistry,
  descriptor: PluginDescriptor,
  signal?: AbortSignal,
): Promise<void> {
  await host.registerComponent(registry, descriptor, signal);
}
