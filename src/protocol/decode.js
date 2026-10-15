// -----------------------------------------------------------------------------
// A packet received from the RFXtrx -> a plain event object (pure).
//
// Byte offsets are those of the whole packet: p[0] is the length byte, p[1]
// the packet type, p[2] the subtype, p[3] the sequence number. The layouts are
// ported from the handlers of node-rfxcom (MIT, Copyright (c) 2012-2017 Kevin
// McDermott, see THIRD_PARTY_NOTICES.md).
//
// Event types:
//   status, receiver-started, not-understood, unknown-rfy-remote,
//   tx-response                 answers of the interface to our commands;
//   sensor                      a measuring sensor (Oregon, OWL…);
//   security                    a Security1 transmitter (door, motion, smoke,
//                               keyfob…);
//   lighting                    a remote or a wall switch (Lighting1/2/5/6).
// Anything else decodes to null.
// -----------------------------------------------------------------------------

import {
  FIRMWARE_TYPES,
  INTERFACE,
  MODELS,
  PACKET,
  PROTOCOLS,
  RECEIVER_TYPES,
  RECEIVERS_433,
  subtypeName,
} from './constants.js';

/** Minimum packet size (length byte included) of each packet type decoded. */
const SIZE = {
  [PACKET.TRANSMITTER_MESSAGE]: 5,
  [PACKET.LIGHTING1]: 8,
  [PACKET.LIGHTING2]: 12,
  [PACKET.LIGHTING5]: 11,
  [PACKET.LIGHTING6]: 12,
  [PACKET.SECURITY1]: 9,
  [PACKET.TEMPERATURE]: 9,
  [PACKET.HUMIDITY]: 9,
  [PACKET.TEMP_HUM]: 11,
  [PACKET.TEMP_HUM_BARO]: 14,
  [PACKET.RAIN]: 12,
  [PACKET.WIND]: 17,
  [PACKET.UV]: 10,
  [PACKET.ELEC1]: 14,
  [PACKET.ELEC23]: 18,
  [PACKET.ELEC4]: 20,
};

/** Uppercase hexadecimal of some bytes, zero-padded: [0x0a, 0xf1] -> "0AF1". */
export const hexId = (bytes) =>
  [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');

const uint = (bytes) => bytes.reduce((value, b) => value * 256 + b, 0);
const round = (value, digits = 1) => Number(value.toFixed(digits));

/** Signed temperature in tenths of a degree, high bit = minus. */
const temperature = (high, low) => {
  const value = round((((high & 0x7f) << 8) | low) / 10);
  return high & 0x80 && value !== 0 ? -value : value;
};

/** Battery level 0-9 -> percent; anything else is not a battery level. */
const battery = (byte) => {
  const level = byte & 0x0f;
  return level <= 9 ? (level + 1) * 10 : null;
};
const signal = (byte) => (byte >> 4) & 0x0f;

export function decodePacket(p) {
  if (!p || p.length < 4 || p[0] !== p.length - 1) {
    return null;
  }
  const type = p[1];
  if (type === PACKET.INTERFACE_MESSAGE) {
    return decodeInterface(p);
  }
  if (SIZE[type] === undefined || p.length < SIZE[type]) {
    return null;
  }
  switch (type) {
    case PACKET.TRANSMITTER_MESSAGE:
      return decodeTransmitterResponse(p);
    case PACKET.LIGHTING1:
    case PACKET.LIGHTING2:
    case PACKET.LIGHTING5:
    case PACKET.LIGHTING6:
      return decodeLighting(p);
    case PACKET.SECURITY1:
      return decodeSecurity(p);
    default:
      return decodeSensor(p);
  }
}

// --- Interface ----------------------------------------------------------------

function decodeInterface(p) {
  const subtype = p[2];
  const seq = p[3];
  if (subtype === INTERFACE.STATUS && p.length >= 14) {
    return decodeStatus(p);
  }
  if (subtype === INTERFACE.RECEIVER_STARTED) {
    return { type: 'receiver-started', seq, text: p.subarray(5, 21).toString('latin1') };
  }
  if (subtype === INTERFACE.NOT_UNDERSTOOD) {
    return { type: 'not-understood', seq };
  }
  if (subtype === INTERFACE.UNKNOWN_RFY_REMOTE) {
    return { type: 'unknown-rfy-remote', seq };
  }
  return null;
}

/**
 * The answer to "get status" and "set mode": receiver type, firmware and the
 * receiving protocols turned on. Packets of 14 bytes come from the old
 * firmwares, of 21 bytes from the current ones (which need "start receiver").
 */
function decodeStatus(p) {
  const receiverType = p[5];
  const current = p.length >= 21;
  const firmwareType = current ? p[14] : null;
  let firmwareVersion = p[6];
  if (current) {
    firmwareVersion += [0x14, 0x15, 0x18].includes(firmwareType) ? 2000 : 1000;
  }
  const protocolBytes = [p[7], p[8], p[9], p[10]];
  const protocols = RECEIVERS_433.includes(receiverType)
    ? Object.entries(PROTOCOLS)
        .filter(([, { msg, bit }]) => protocolBytes[msg - 3] & bit)
        .map(([name]) => name)
    : [];
  return {
    type: 'status',
    seq: p[3],
    command: p[4],
    receiverType,
    receiverName: RECEIVER_TYPES[receiverType] ?? `unknown receiver 0x${hexId([receiverType])}`,
    firmwareVersion,
    firmwareType: current
      ? (FIRMWARE_TYPES[firmwareType] ?? `type 0x${hexId([firmwareType])}`)
      : null,
    hardwareVersion: `${p[11]}.${p[12]}`,
    protocols,
    protocolBytes,
    needsStartReceiver: current,
  };
}

const TX_ANSWERS = {
  0x00: 'transmit OK',
  0x01: 'transmit delayed',
  0x02: 'the transmitter did not lock onto the frequency',
  0x03: 'AC address zero is not allowed',
};

function decodeTransmitterResponse(p) {
  // Subtype 0x00: the receiver did not lock; 0x01: the answer to a transmit.
  const code = p[2] === 0x00 ? 0x02 : p[4];
  return {
    type: 'tx-response',
    seq: p[3],
    ok: code === 0x00 || code === 0x01,
    code,
    message: TX_ANSWERS[code] ?? `answer 0x${hexId([code])}`,
  };
}

// --- Remotes and wall switches ----------------------------------------------

const LIGHTING1_COMMANDS = {
  0: 'off',
  1: 'on',
  2: 'dim',
  3: 'bright',
  5: 'all-off',
  6: 'all-on',
  7: 'chime',
};
const LIGHTING2_COMMANDS = {
  0: 'off',
  1: 'on',
  2: 'level',
  3: 'group-off',
  4: 'group-on',
  5: 'group-level',
};
const LIGHTING5_COMMANDS = {
  LIGHTWAVERF: {
    0: 'off',
    1: 'on',
    2: 'group-off',
    3: 'mood-1',
    4: 'mood-2',
    5: 'mood-3',
    6: 'mood-4',
    7: 'mood-5',
    13: 'close',
    14: 'stop',
    15: 'open',
    16: 'level',
  },
  GROUPED: { 0: 'off', 1: 'on', 2: 'group-off', 3: 'group-on' },
  OTHER: { 0: 'off', 1: 'on' },
};
const LIGHTING5_GROUPED = ['BBSB', 'CONRAD', 'EURODOMEST', 'KANGTAI'];
const LIGHTING6_COMMANDS = { 0: 'on', 1: 'off', 2: 'group-on', 3: 'group-off' };

const commandName = (table, value) => table[value] ?? `command-${value}`;
const percent = (level, max) => Math.round((Math.min(level, max) * 100) / max);

/**
 * `address` names the remote (its house code or identifier), `unit` the
 * button as the protocol numbers it, `button` the key of the button in the
 * Gladys device: "1", "A3", "group", "all".
 */
function decodeLighting(p) {
  const packetType = p[1];
  const subtype = p[2];
  const protocol = subtypeName(packetType, subtype) ?? `0x${hexId([packetType, subtype])}`;
  const base = { type: 'lighting', packetType, subtype, protocol, level: null };
  switch (packetType) {
    case PACKET.LIGHTING1: {
      if (p[6] === 0xff) {
        return null; // "illegal command": a garbled frame
      }
      const command = commandName(LIGHTING1_COMMANDS, p[6]);
      const unit = p[5];
      const all = command.startsWith('all-') || unit === 0;
      return {
        ...base,
        address: String.fromCharCode(p[4]).toUpperCase(),
        unit,
        button: all ? 'all' : String(unit),
        command,
        signal: signal(p[7]),
      };
    }
    case PACKET.LIGHTING2: {
      const command = commandName(LIGHTING2_COMMANDS, p[9]);
      const id = (p[4] & 0x03) * 0x1000000 + uint([p[5], p[6], p[7]]);
      return {
        ...base,
        address: id.toString(16).toUpperCase(),
        unit: p[8],
        button: command.startsWith('group-') ? 'group' : String(p[8]),
        command,
        level: command.endsWith('level') ? percent(p[10], 15) : null,
        signal: signal(p[11]),
      };
    }
    case PACKET.LIGHTING5: {
      let table = LIGHTING5_COMMANDS.OTHER;
      if (protocol === 'LIGHTWAVERF') {
        table = LIGHTING5_COMMANDS.LIGHTWAVERF;
      } else if (LIGHTING5_GROUPED.includes(protocol)) {
        table = LIGHTING5_COMMANDS.GROUPED;
      }
      const command = commandName(table, p[8]);
      return {
        ...base,
        address: uint([p[4], p[5], p[6]]).toString(16).toUpperCase(),
        unit: p[7],
        button: command.startsWith('group-') ? 'group' : String(p[7]),
        command,
        level: command === 'level' ? percent(p[9], 31) : null,
        signal: signal(p[10]),
      };
    }
    default: {
      const command = commandName(LIGHTING6_COMMANDS, p[8]);
      const group = String.fromCharCode(p[6]).toUpperCase();
      return {
        ...base,
        address: hexId([p[4], p[5]]),
        group,
        unit: p[7],
        button: command.startsWith('group-') ? group : `${group}${p[7]}`,
        command,
        signal: signal(p[11]),
      };
    }
  }
}

// --- Security sensors and keyfobs ------------------------------------------

function decodeSecurity(p) {
  const subtype = p[2];
  let id;
  if (subtype <= 0x02) {
    id = [p[4], p[6]]; // X10 security: id1 and id3
  } else if (subtype === 0x03 || subtype === 0x09) {
    id = [p[4], p[5]];
  } else {
    id = [p[4], p[5], p[6]];
  }
  return {
    type: 'security',
    packetType: PACKET.SECURITY1,
    subtype,
    protocol: subtypeName(PACKET.SECURITY1, subtype) ?? `0x20${hexId([subtype])}`,
    address: hexId(id),
    status: p[7] & 0x7f,
    tamper: (p[7] & 0x80) !== 0,
    battery: battery(p[8]),
    signal: signal(p[8]),
  };
}

// --- Measuring sensors --------------------------------------------------------

function decodeSensor(p) {
  const packetType = p[1];
  const subtype = p[2];
  const measures = {};
  let status;
  switch (packetType) {
    case PACKET.TEMPERATURE:
      measures.temperature = temperature(p[6], p[7]);
      status = p[8];
      break;
    case PACKET.HUMIDITY:
      measures.humidity = p[6];
      status = p[8];
      break;
    case PACKET.TEMP_HUM:
      measures.temperature = temperature(p[6], p[7]);
      measures.humidity = p[8];
      status = p[10];
      break;
    case PACKET.TEMP_HUM_BARO:
      measures.temperature = temperature(p[6], p[7]);
      measures.humidity = p[8];
      measures.pressure = ((p[10] & 0x7f) << 8) | p[11];
      status = p[13];
      break;
    case PACKET.RAIN:
      if (subtype === 1) {
        measures.rainRate = uint([p[6], p[7]]);
      } else if (subtype === 2) {
        measures.rainRate = round(uint([p[6], p[7]]) / 100, 2);
      }
      // Subtypes 6, 8, 9 and 10 send increments (non-Oregon gauges): left out.
      if (![6, 8, 9, 10].includes(subtype)) {
        measures.rainTotal = round(uint([p[8], p[9], p[10]]) / 10);
      }
      status = p[11];
      break;
    case PACKET.WIND:
      if (subtype !== 8) {
        measures.windDirection = uint([p[6], p[7]]);
      }
      if (subtype !== 5) {
        measures.windSpeed = round(uint([p[8], p[9]]) / 10);
      }
      measures.windGust = round(uint([p[10], p[11]]) / 10);
      if (subtype === 4) {
        measures.temperature = temperature(p[12], p[13]);
        measures.windChill = temperature(p[14], p[15]);
      }
      status = p[16];
      break;
    case PACKET.UV:
      measures.uv = round(p[6] / 10);
      if (subtype === 3) {
        measures.temperature = temperature(p[7], p[8]);
      }
      status = p[9];
      break;
    case PACKET.ELEC1:
      Object.assign(measures, currents(p, 7));
      status = p[13];
      break;
    case PACKET.ELEC23:
      measures.power = uint([p[7], p[8], p[9], p[10]]);
      if (subtype === 1 || (subtype === 2 && p[6] === 0)) {
        // Watt-hours, in the 1/223.666 units of the OWL counter.
        measures.energy = round(uint([...p.subarray(11, 17)]) / 223.666 / 1000, 3);
      }
      status = p[17];
      break;
    case PACKET.ELEC4:
      Object.assign(measures, currents(p, 7));
      if (p[6] === 0) {
        measures.energy = round(uint([...p.subarray(13, 19)]) / 223.666 / 1000, 3);
      }
      status = p[19];
      break;
    default:
      return null;
  }
  return {
    type: 'sensor',
    packetType,
    subtype,
    address: hexId([p[4], p[5]]),
    model: MODELS[packetType]?.[subtype] || `RFXCOM 0x${hexId([packetType, subtype])}`,
    measures,
    battery: battery(status),
    signal: signal(status),
  };
}

/** The three clamps of an OWL CM113 / CM180i, in amperes. */
function currents(p, offset) {
  return {
    current1: round(uint([p[offset], p[offset + 1]]) / 10),
    current2: round(uint([p[offset + 2], p[offset + 3]]) / 10),
    current3: round(uint([p[offset + 4], p[offset + 5]]) / 10),
  };
}
