// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { parseActuators } from './actuators.js';
import { DEFAULT_PORT } from './constants.js';
import { PROTOCOLS } from './protocol/constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  host: '',
  port: DEFAULT_PORT,
  receiver_protocols: [],
  min_signal: 0,
  actuators: '',
};

export const MIN_SIGNAL = { min: 0, max: 15 };

/**
 * The receiving protocols offered in the configuration (manifest options):
 * those whose packets the integration decodes.
 */
export const RECEIVER_PROTOCOLS = [
  'AC',
  'ARC',
  'X10',
  'HOMEEASY',
  'OREGON',
  'VISONIC',
  'BLYSS',
  'LIGHTWAVERF',
  'MEIANTECH',
  'LACROSSE',
  'RUBICSON',
  'FINEOFFSET',
  'HIDEKI',
  'LEGRAND',
  'RSL',
  'IMAGINTRONIX',
];

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|0\.0\.0\.0)$/i;

/**
 * The bridge address: "192.168.1.10", "rfx.lan", or "192.168.1.10:4001" (the
 * port then overrides the port field).
 * @returns {{ host: string, port?: number } | { error: 'empty'|'invalid'|'localhost' }}
 */
export function parseHost(raw) {
  let text = String(raw ?? '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/+$/, '');
  if (text === '') {
    return { error: 'empty' };
  }
  let port;
  const withPort = /^([^:\s]+):(\d{1,5})$/.exec(text);
  if (withPort) {
    text = withPort[1];
    port = Number(withPort[2]);
  }
  if (!/^[a-z0-9.-]+$/i.test(text) && !/^[0-9a-f:]+$/i.test(text)) {
    return { error: 'invalid' };
  }
  if (LOOPBACK.test(text)) {
    return { error: 'localhost' };
  }
  return port >= 1 && port <= 65535 ? { host: text, port } : { host: text };
}

const toList = (value) => {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const host = parseHost(c.host);
  const { actuators, errors } = parseActuators(c.actuators);
  return {
    host: host.host ?? null,
    hostError: host.error ?? null,
    port: host.port ?? clampInt(c.port, 1, 65535, DEFAULT_PORT),
    protocols: [...new Set(toList(c.receiver_protocols).map((p) => p.toUpperCase()))].filter(
      (p) => PROTOCOLS[p],
    ),
    minSignal: clampInt(c.min_signal, MIN_SIGNAL.min, MIN_SIGNAL.max, DEFAULTS.min_signal),
    actuatorsText: String(c.actuators ?? ''),
    actuators,
    actuatorErrors: errors,
  };
}
