import type { AvayaSidecarConfig } from './config.js';

type UuiConfig = AvayaSidecarConfig['uui'];

const PRINTABLE = /^[\x20-\x7E]*$/;

function hexToAscii(hex: string): string | undefined {
  if (!/^(?:[0-9A-Fa-f]{2})*$/.test(hex)) return undefined;
  let out = '';
  for (let i = 0; i < hex.length; i += 2)
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return PRINTABLE.test(out) ? out : undefined;
}

/**
 * UUI → `uui.*` variables. Never throws: UUI is customer-influenced data (IVR, ISDN), so it is
 * decoded defensively, bounded and filtered by the allow-list.
 */
export function decodeUui(
  uui: string | undefined,
  encoding: 'ascii' | 'hex',
  config: UuiConfig,
): Record<string, string> {
  if (uui === undefined || uui === '') return {};
  const out: Record<string, string> = {};
  const put = (key: string, value: string) => {
    const name = key.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48);
    if (name === '' || (config.allow.length > 0 && !config.allow.includes(name))) return;
    if (Object.keys(out).length < 50) out[`uui.${name}`] = value.slice(0, 1_000);
  };
  if (config.format === 'shared') {
    if (encoding !== 'hex') return {};
    // Shared UUI: repeated [id:1 byte][length:1 byte][data:length bytes].
    for (let i = 0; i + 4 <= uui.length;) {
      const id = uui.slice(i, i + 2).toUpperCase();
      const len = parseInt(uui.slice(i + 2, i + 4), 16);
      const data = uui.slice(i + 4, i + 4 + len * 2);
      if (Number.isNaN(len) || data.length !== len * 2) break;
      const name = config.sharedIds[id] ?? config.sharedIds[id.toLowerCase()];
      const text = hexToAscii(data);
      if (name !== undefined) put(name, text ?? data);
      i += 4 + len * 2;
    }
    return out;
  }
  const text = encoding === 'hex' ? hexToAscii(uui) : uui;
  if (text === undefined || !PRINTABLE.test(text))
    return config.allow.length === 0 || config.allow.includes('raw')
      ? { 'uui.raw': uui.slice(0, 1_000) }
      : {};
  if (config.format === 'raw') {
    put('raw', text);
    return out;
  }
  for (const pair of text.split(config.pairSeparator)) {
    const at = pair.indexOf(config.keyValueSeparator);
    if (at <= 0) continue;
    put(pair.slice(0, at).trim(), pair.slice(at + config.keyValueSeparator.length).trim());
  }
  return out;
}
