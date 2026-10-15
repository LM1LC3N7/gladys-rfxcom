// -----------------------------------------------------------------------------
// The receivers the RFXtrx drives: plugs, light modules, Somfy RTS motors.
//
// A receiver is never heard on the air, so the user declares it, in the
// `actuators` field of the configuration (the "Pair an actuator" button fills
// it), one entry per receiver, separated by ";":
//
//   Name = kind PROTOCOL address
//   Living room = shutter RFY 10203/1; Desk lamp = dimmer AC 1A2B3C4/2
//
// This module parses and checks those entries (pure), and turns an order
// (on, off, a level, up, down, stop, program) into the packet of its protocol.
// The address limits come from node-rfxcom (MIT, see THIRD_PARTY_NOTICES.md).
// -----------------------------------------------------------------------------

import { PACKET, RFY_COMMAND, subtypeOf } from './protocol/constants.js';
import {
  lighting1Packet,
  lighting2Packet,
  lighting5Packet,
  lighting6Packet,
  rfyPacket,
} from './protocol/encode.js';

export const KINDS = ['switch', 'light', 'dimmer', 'shutter'];

const LIGHTING1_UNITS = {
  X10: 16,
  ARC: 16,
  WAVEMAN: 16,
  ELRO: 64,
  IMPULS: 64,
  HQ: 64,
  PHILIPS_SBC: 8,
  ENERGENIE_5_GANG: 10,
  CHACON: 4,
  RISING_SUN: 4,
  ENERGENIE_ENER010: 4,
  COCO: 4,
  OASE_FM: 3,
};
const LIGHTING1_HOUSES = { CHACON: 'C', RISING_SUN: 'D', COCO: 'D', HQ: 'D' };
/** Lighting1 protocols with "all on / all off" (unit 0). */
const LIGHTING1_ALL = ['X10', 'ARC', 'PHILIPS_SBC', 'ENERGENIE_ENER010'];

/** Lighting5 protocols supported for transmission: [max id, max unit]. */
const LIGHTING5_LIMITS = {
  LIGHTWAVERF: [0xffffff, 16],
  CONRAD: [0xffffff, 16],
  EMW100: [0x3fff, 4],
  BBSB: [0x7ffff, 6],
  EURODOMEST: [0xfffff, 4],
  IT: [0xffff, 4],
  KANGTAI: [0xffff, 30],
};

/** Protocol name -> its packet family. Every protocol of the pairing list. */
export const PROTOCOLS = {
  ...Object.fromEntries(Object.keys(LIGHTING1_UNITS).map((p) => [p, PACKET.LIGHTING1])),
  AC: PACKET.LIGHTING2,
  HOMEEASY_EU: PACKET.LIGHTING2,
  ANSLUT: PACKET.LIGHTING2,
  ...Object.fromEntries(Object.keys(LIGHTING5_LIMITS).map((p) => [p, PACKET.LIGHTING5])),
  BLYSS: PACKET.LIGHTING6,
  RFY: PACKET.RFY,
  RFYEXT: PACKET.RFY,
};

/** The protocols that carry a level, and its maximum value. */
const DIMMABLE = { AC: 15, HOMEEASY_EU: 15, LIGHTWAVERF: 31 };
const SHUTTERS = ['RFY', 'RFYEXT'];

const hexOf = (id) => id.toString(16).toUpperCase();

function parseHex(text, max) {
  if (!/^(0x)?[0-9a-f]{1,8}$/i.test(text)) {
    return null;
  }
  const id = parseInt(text.replace(/^0x/i, ''), 16);
  return id >= 1 && id <= max ? id : null;
}

function parseUnit(text, min, max) {
  if (!/^\d{1,3}$/.test(text)) {
    return null;
  }
  const unit = Number(text);
  return unit >= min && unit <= max ? unit : null;
}

/**
 * Checks an address for a protocol.
 * @returns {{ parts: object, address: string } | null} the canonical address
 *   ("A3", "1A2B3C4/1", "F09A/B/1") and its parts, or null when invalid.
 */
export function parseAddress(protocol, raw) {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase();
  const family = PROTOCOLS[protocol];
  if (family === PACKET.LIGHTING1) {
    const match = /^([A-P])(\d{1,2})$/.exec(text);
    if (!match || match[1] > (LIGHTING1_HOUSES[protocol] ?? 'P')) {
      return null;
    }
    const unit = parseUnit(
      match[2],
      LIGHTING1_ALL.includes(protocol) ? 0 : 1,
      LIGHTING1_UNITS[protocol],
    );
    return unit === null
      ? null
      : { parts: { house: match[1], unit }, address: `${match[1]}${unit}` };
  }
  const pieces = text.split('/');
  if (family === PACKET.LIGHTING6) {
    if (pieces.length !== 3 || !/^[A-P]$/.test(pieces[1])) {
      return null;
    }
    const id = parseHex(pieces[0], 0xffff);
    const unit = parseUnit(pieces[2], 0, 5);
    if (id === null || unit === null) {
      return null;
    }
    return {
      parts: { id, group: pieces[1], unit },
      address: `${hexOf(id)}/${pieces[1]}/${unit}`,
    };
  }
  if (pieces.length !== 2) {
    return null;
  }
  let limits;
  if (family === PACKET.LIGHTING2) {
    limits = [0x3ffffff, 0, 16];
  } else if (family === PACKET.LIGHTING5) {
    limits = [LIGHTING5_LIMITS[protocol][0], 1, LIGHTING5_LIMITS[protocol][1]];
  } else if (family === PACKET.RFY) {
    limits = [0xfffff, 0, protocol === 'RFY' ? 4 : 15];
  } else {
    return null;
  }
  const id = parseHex(pieces[0], limits[0]);
  const unit = parseUnit(pieces[1], limits[1], limits[2]);
  if (id === null || unit === null) {
    return null;
  }
  return { parts: { id, unit }, address: `${hexOf(id)}/${unit}` };
}

/** The kinds a protocol can drive. */
export function kindsOf(protocol) {
  if (SHUTTERS.includes(protocol)) {
    return ['shutter'];
  }
  return DIMMABLE[protocol] ? ['switch', 'light', 'dimmer'] : ['switch', 'light'];
}

/**
 * Builds one actuator.
 * @returns {{ actuator: object } | { error: string }} error: kind, protocol,
 *   address or kind-protocol.
 */
export function makeActuator({ name, kind, protocol, address }) {
  const proto = String(protocol ?? '')
    .trim()
    .toUpperCase();
  const k = String(kind ?? '')
    .trim()
    .toLowerCase();
  if (!KINDS.includes(k)) {
    return { error: 'kind' };
  }
  if (!PROTOCOLS[proto]) {
    return { error: 'protocol' };
  }
  if (!kindsOf(proto).includes(k)) {
    return { error: 'kind-protocol' };
  }
  const parsed = parseAddress(proto, address);
  if (!parsed) {
    return { error: 'address' };
  }
  const packetType = PROTOCOLS[proto];
  return {
    actuator: {
      name: String(name ?? '').trim() || `${proto} ${parsed.address}`,
      kind: k,
      protocol: proto,
      packetType,
      subtype: subtypeOf(packetType, proto),
      address: parsed.address,
      parts: parsed.parts,
      platformId: `${proto}-${parsed.address.replaceAll('/', '-')}`,
    },
  };
}

/**
 * Parses the `actuators` configuration field.
 * @returns {{ actuators: object[], errors: { entry: string, error: string }[] }}
 */
export function parseActuators(text) {
  const actuators = [];
  const errors = [];
  const seen = new Set();
  for (const raw of String(text ?? '').split(/[;\n]/)) {
    const entry = raw.trim();
    if (entry === '') {
      continue;
    }
    const match = /^([^=]*)=\s*(\S+)\s+(\S+)\s+(\S+)$/.exec(entry);
    if (!match) {
      errors.push({ entry, error: 'syntax' });
      continue;
    }
    const result = makeActuator({
      name: match[1],
      kind: match[2],
      protocol: match[3],
      address: match[4],
    });
    if (result.error) {
      errors.push({ entry, error: result.error });
      continue;
    }
    if (seen.has(result.actuator.platformId)) {
      errors.push({ entry, error: 'duplicate' });
      continue;
    }
    seen.add(result.actuator.platformId);
    actuators.push(result.actuator);
  }
  return { actuators, errors };
}

/** The configuration entry of an actuator (what "Pair an actuator" appends). */
export const formatActuator = (a) => `${a.name} = ${a.kind} ${a.protocol} ${a.address}`;

/** A free address for a protocol whose receivers learn the transmitter. */
export function randomAddress(protocol, random = Math.random) {
  const pick = (min, max) => min + Math.floor(random() * (max - min + 1));
  const family = PROTOCOLS[protocol];
  if (family === PACKET.LIGHTING2) {
    return `${hexOf(pick(0x100000, 0x3ffffff))}/1`;
  }
  if (family === PACKET.LIGHTING5) {
    return `${hexOf(pick(0x100, LIGHTING5_LIMITS[protocol][0]))}/1`;
  }
  if (family === PACKET.LIGHTING6) {
    return `${hexOf(pick(0x100, 0xffff))}/A/1`;
  }
  if (family === PACKET.RFY) {
    return `${hexOf(pick(0x10000, 0xfffff))}/1`;
  }
  return null; // Lighting1: the address is set on the receiver (code wheels).
}

/** The pairing order: "program" for a Somfy RTS motor, "on" for the others. */
export const pairingOrder = (actuator) => (SHUTTERS.includes(actuator.protocol) ? 'program' : 'on');

/**
 * The packet of an order, as a function of the sequence number.
 * @param {object} actuator
 * @param {'on'|'off'|'up'|'down'|'stop'|'program'|{ level: number }} order
 *   level: 1-100 (percent).
 * @param {{ rolling?: number }} [state] Blyss command counter.
 */
export function orderPacket(actuator, order, { rolling = 0 } = {}) {
  const { packetType, subtype, parts, protocol } = actuator;
  const level = typeof order === 'object' ? order.level : null;
  if (packetType === PACKET.RFY) {
    const command = { up: RFY_COMMAND.UP, down: RFY_COMMAND.DOWN, stop: RFY_COMMAND.STOP }[order];
    const code = order === 'program' ? RFY_COMMAND.PROGRAM : command;
    if (code === undefined) {
      throw new Error(`${protocol} cannot do ${JSON.stringify(order)}`);
    }
    return (seq) => rfyPacket(seq, { subtype, ...parts }, code);
  }
  if (!['on', 'off'].includes(order) && level === null) {
    throw new Error(`${protocol} cannot do ${JSON.stringify(order)}`);
  }
  const on = order === 'on';
  switch (packetType) {
    case PACKET.LIGHTING1: {
      if (level !== null) {
        throw new Error(`${protocol} has no level`);
      }
      const command = parts.unit === 0 ? (on ? 6 : 5) : on ? 1 : 0;
      return (seq) => lighting1Packet(seq, { subtype, ...parts }, command);
    }
    case PACKET.LIGHTING2: {
      const group = parts.unit === 0;
      const unit = group ? 1 : parts.unit; // group commands go out with unit 1
      let command = on ? 1 : 0;
      let value = on ? 15 : 0;
      if (level !== null) {
        command = 2;
        value = Math.max(1, Math.round((level * DIMMABLE.AC) / 100));
      }
      const final = group ? command + 3 : command;
      return (seq) => lighting2Packet(seq, { subtype, id: parts.id, unit }, final, value);
    }
    case PACKET.LIGHTING5: {
      let command = on ? 1 : 0;
      let value = on ? 0x1f : 0;
      if (level !== null) {
        if (protocol !== 'LIGHTWAVERF') {
          throw new Error(`${protocol} has no level`);
        }
        command = 0x10;
        value = Math.max(1, Math.round((level * DIMMABLE.LIGHTWAVERF) / 100));
      }
      return (seq) => lighting5Packet(seq, { subtype, ...parts }, command, value);
    }
    case PACKET.LIGHTING6: {
      if (level !== null) {
        throw new Error(`${protocol} has no level`);
      }
      const command = (on ? 0 : 1) + (parts.unit === 0 ? 2 : 0);
      return (seq) => lighting6Packet(seq, { subtype, ...parts }, command, rolling);
    }
    default:
      throw new Error(`${protocol} cannot be driven`);
  }
}

/**
 * Whether a remote heard on the air speaks to an actuator: a press on the
 * user's own remote then moves the state of the receiver it drives.
 * @returns {'unit'|'group'|null}
 */
export function heardBy(actuator, event) {
  if (event.packetType !== actuator.packetType || event.subtype !== actuator.subtype) {
    return null;
  }
  const { parts } = actuator;
  const group = event.button === 'group' || event.button === 'all' || event.button === event.group;
  if (event.packetType === PACKET.LIGHTING1) {
    if (event.address !== parts.house) {
      return null;
    }
  } else if (parseInt(event.address, 16) !== parts.id) {
    return null;
  } else if (event.packetType === PACKET.LIGHTING6 && event.group !== parts.group) {
    return null;
  }
  if (group) {
    return 'group';
  }
  return event.unit === parts.unit ? 'unit' : null;
}
