// -----------------------------------------------------------------------------
// Radio events -> Gladys devices, features and states (pure).
//
// Three families are heard on the air and offered in the Discovery tab:
//   sensor    measuring sensors (Oregon, OWL…): one feature per measure heard;
//   detector  Security1 door, motion and smoke detectors;
//   remote    remotes, wall switches and keyfobs: one BUTTON feature per
//             button heard, and the `remote_pressed` scene trigger.
// The fourth, `actuator`, is declared by the user (src/actuators.js).
//
// External ids are forever: `ext:<selector>:<family>:<packet>-<subtype>-<id>`
// for what is heard, `ext:<selector>:actuator:<PROTOCOL>-<address>` for the
// receivers.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { BUTTON_STATUS, COVER_STATE, OPENING_SENSOR_STATE } from './constants.js';
import { PACKET, SECURITY_STATUS as S } from './protocol/constants.js';
import { hexId } from './protocol/decode.js';

export const FAMILIES = { SENSOR: 'sensor', DETECTOR: 'detector', REMOTE: 'remote' };
export const ACTUATOR = 'actuator';

/** Measures of the sensor events -> features. `optional`: only once non-zero. */
export const MEASURES = {
  temperature: {
    key: 'temperature',
    name: 'Temperature',
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -50,
    max: 80,
  },
  humidity: {
    key: 'humidity',
    name: 'Humidity',
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  },
  pressure: {
    key: 'pressure',
    name: 'Pressure',
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.HECTO_PASCAL,
    min: 800,
    max: 1200,
  },
  rainTotal: {
    key: 'rain-total',
    name: 'Total rain',
    category: C.PRECIPITATION_SENSOR,
    type: T.PRECIPITATION_SENSOR.DECIMAL,
    unit: U.MM,
    min: 0,
    max: 100_000,
  },
  rainRate: {
    key: 'rain-rate',
    name: 'Rain rate',
    category: C.PRECIPITATION_SENSOR,
    type: T.PRECIPITATION_SENSOR.DECIMAL,
    unit: U.MILLIMETER_PER_HOUR,
    min: 0,
    max: 1000,
  },
  windDirection: {
    key: 'wind-direction',
    name: 'Wind direction',
    category: C.ANGLE_SENSOR,
    type: T.SENSOR.INTEGER,
    unit: U.DEGREE,
    min: 0,
    max: 359,
  },
  windSpeed: {
    key: 'wind-speed',
    name: 'Wind speed',
    category: C.SPEED_SENSOR,
    type: T.SPEED_SENSOR.DECIMAL,
    unit: U.METER_PER_SECOND,
    min: 0,
    max: 100,
  },
  windGust: {
    key: 'wind-gust',
    name: 'Wind gust',
    category: C.SPEED_SENSOR,
    type: T.SPEED_SENSOR.DECIMAL,
    unit: U.METER_PER_SECOND,
    min: 0,
    max: 100,
  },
  windChill: {
    key: 'wind-chill',
    name: 'Wind chill',
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -60,
    max: 80,
  },
  uv: {
    key: 'uv',
    name: 'UV index',
    category: C.UV_SENSOR,
    type: T.UV_SENSOR.INTEGER,
    unit: U.UV_INDEX,
    min: 0,
    max: 20,
    round: true,
  },
  power: {
    key: 'power',
    name: 'Power',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: 0,
    max: 100_000,
  },
  energy: {
    key: 'energy',
    name: 'Energy',
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.INDEX,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: 1e9,
  },
};
for (const phase of [1, 2, 3]) {
  MEASURES[`current${phase}`] = {
    key: `current-${phase}`,
    name: `Current phase ${phase}`,
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    unit: U.AMPERE,
    min: 0,
    max: 1000,
    optional: phase > 1,
  };
}

const DETECTIONS = {
  opening: { key: 'opening', name: 'Opening', category: C.OPENING_SENSOR },
  motion: { key: 'motion', name: 'Motion', category: C.MOTION_SENSOR },
  smoke: { key: 'smoke', name: 'Smoke', category: C.SMOKE_SENSOR },
};

/** Security1 subtypes -> what they detect. X10_SECURITY and CODE_SECURE are keyfobs. */
const SECURITY_DETECTION = {
  0x00: 'opening', // X10 door / window
  0x01: 'motion', // X10 motion
  0x03: 'smoke', // KD101
  0x04: 'opening', // Visonic PowerCode door / window
  0x05: 'motion', // Visonic PowerCode motion
  0x07: 'opening', // Visonic PowerCode auxiliary contact
  0x08: 'motion', // Meiantech
  0x09: 'smoke', // SA30 / SA33
  0x0a: 'smoke', // RM174RF / RM175RF
  0x0b: 'opening', // Ferport TAC
};

/** Keyfob statuses -> [button, command]. */
const KEYFOB = {
  [S.ARM_AWAY]: ['alarm', 'arm-away'],
  [S.ARM_AWAY_DELAYED]: ['alarm', 'arm-away'],
  [S.ARM_HOME]: ['alarm', 'arm-home'],
  [S.ARM_HOME_DELAYED]: ['alarm', 'arm-home'],
  [S.DISARM]: ['alarm', 'disarm'],
  [S.PANIC]: ['alarm', 'panic'],
  [S.END_PANIC]: ['alarm', 'end-panic'],
  [S.LIGHT1_ON]: ['light-1', 'on'],
  [S.LIGHT1_OFF]: ['light-1', 'off'],
  [S.LIGHT2_ON]: ['light-2', 'on'],
  [S.LIGHT2_OFF]: ['light-2', 'off'],
};
const DETECTED = [S.ALARM, S.ALARM_DELAYED, S.MOTION, S.PANIC];
const CLEARED = [S.NORMAL, S.NORMAL_DELAYED, S.NO_MOTION, S.END_PANIC];

/** Commands of the remotes -> BUTTON_STATUS of Gladys. */
const BUTTON_VALUES = {
  on: BUTTON_STATUS.ON,
  'group-on': BUTTON_STATUS.ON,
  'all-on': BUTTON_STATUS.ON,
  off: BUTTON_STATUS.OFF,
  'group-off': BUTTON_STATUS.OFF,
  'all-off': BUTTON_STATUS.OFF,
  bright: BUTTON_STATUS.BRIGHTNESS_MOVE_UP,
  dim: BUTTON_STATUS.BRIGHTNESS_MOVE_DOWN,
  'arm-away': BUTTON_STATUS.ARM_ALL_ZONES,
  'arm-home': BUTTON_STATUS.ARM_DAY_ZONES,
  disarm: BUTTON_STATUS.DISARM,
  panic: BUTTON_STATUS.EMERGENCY,
  'end-panic': BUTTON_STATUS.RELEASE,
};
export const buttonValue = (command) => BUTTON_VALUES[command] ?? BUTTON_STATUS.CLICK;

const LABELS = {
  X10: 'X10',
  ARC: 'ARC',
  CHACON: 'Chacon',
  AC: 'Chacon DiO / KlikAanKlikUit',
  HOMEEASY_EU: 'HomeEasy EU',
  ANSLUT: 'Anslut',
  LIGHTWAVERF: 'LightwaveRF',
  CONRAD: 'Conrad RSL',
  BLYSS: 'Blyss',
  X10_DOOR: 'X10 door sensor',
  X10_PIR: 'X10 motion sensor',
  X10_SECURITY: 'X10 security remote',
  KD101: 'KD101 smoke detector',
  POWERCODE_DOOR: 'Visonic door sensor',
  POWERCODE_PIR: 'Visonic motion sensor',
  CODE_SECURE: 'Visonic CodeSecure keyfob',
  POWERCODE_AUX: 'Visonic contact',
  MEIANTECH: 'Meiantech',
  SA30: 'SA30 smoke detector',
  RM174RF: 'RM174RF smoke detector',
  FERPORT_TAC: 'Ferport TAC',
};
const label = (protocol) => LABELS[protocol] ?? protocol.replaceAll('_', ' ');

const platformIdOf = (event) =>
  `${hexId([event.packetType])}-${hexId([event.subtype])}-${event.address}`;

/** RSSI 0-15 -> 0-5 bars. */
export const signalBars = (rssi) => Math.round((rssi * 5) / 15);

/**
 * A decoded event -> what the registry of emitters heard records, and the
 * values it carries.
 * @returns {object|null} reading: { family, platformId, protocol, packetType,
 *   subtype, address, model?, detection?, values: { featureKey: value },
 *   measures: [], button?: { key, command, level }, battery, tamper, signal }
 */
export function classify(event) {
  const reading = classifyEvent(event);
  if (reading) {
    if (reading.battery !== null) {
      reading.values.battery = reading.battery;
    }
    if (reading.family !== FAMILIES.REMOTE && reading.signal !== null) {
      reading.values.signal = signalBars(reading.signal);
    }
  }
  return reading;
}

function classifyEvent(event) {
  if (!event || !['sensor', 'security', 'lighting'].includes(event.type)) {
    return null;
  }
  const base = {
    platformId: platformIdOf(event),
    packetType: event.packetType,
    subtype: event.subtype,
    address: event.address,
    measures: [],
    values: {},
    battery: event.battery ?? null,
    signal: event.signal ?? null,
    tamper: null,
  };
  if (event.type === 'sensor') {
    const reading = { ...base, family: FAMILIES.SENSOR, protocol: event.model, model: event.model };
    for (const [name, raw] of Object.entries(event.measures)) {
      const spec = MEASURES[name];
      if (!spec || !Number.isFinite(raw)) {
        continue;
      }
      const value = Math.min(spec.max, Math.max(spec.min, spec.round ? Math.round(raw) : raw));
      if (!spec.optional || value !== 0) {
        reading.measures.push(spec.key);
      }
      reading.values[spec.key] = value;
    }
    return reading;
  }
  if (event.type === 'lighting') {
    return {
      ...base,
      family: FAMILIES.REMOTE,
      protocol: event.protocol,
      battery: null,
      button: { key: event.button, command: event.command, level: event.level },
    };
  }
  // Security1: a keyfob press, or a detector.
  const keyfob = KEYFOB[event.status];
  const detection = SECURITY_DETECTION[event.subtype];
  if (keyfob && (!detection || detection === 'motion')) {
    return {
      ...base,
      family: FAMILIES.REMOTE,
      protocol: event.protocol,
      button: { key: keyfob[0], command: keyfob[1], level: null },
    };
  }
  if (!detection) {
    return null; // a keyfob status we do not map
  }
  const reading = {
    ...base,
    family: FAMILIES.DETECTOR,
    protocol: event.protocol,
    detection,
    tamper: event.tamper,
  };
  let detected = null;
  if (DETECTED.includes(event.status)) {
    detected = 1;
  } else if (CLEARED.includes(event.status)) {
    detected = 0;
  }
  if (detected !== null) {
    reading.values[detection] =
      detection === 'opening'
        ? detected
          ? OPENING_SENSOR_STATE.OPEN
          : OPENING_SENSOR_STATE.CLOSE
        : detected;
    reading.detected = detected === 1;
  }
  reading.values.tamper = event.tamper ? 1 : 0;
  return reading;
}

// --- Gladys devices -----------------------------------------------------------

const feature = (ids, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(key),
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

function commonFeatures(ids, entry) {
  const features = [];
  if (entry.battery) {
    features.push(
      feature(ids, 'battery', 'Battery', C.BATTERY, T.BATTERY.INTEGER, {
        unit: U.PERCENT,
        max: 100,
      }),
    );
  }
  if (entry.family !== FAMILIES.REMOTE) {
    features.push(
      feature(ids, 'signal', 'Signal', C.SIGNAL, T.SIGNAL.QUALITY, { max: 5, keep_history: false }),
    );
  }
  return features;
}

function buttonName(key) {
  if (/^\d+$/.test(key)) {
    return `Button ${key}`;
  }
  const names = {
    group: 'Group',
    all: 'All',
    alarm: 'Alarm',
    'light-1': 'Light 1',
    'light-2': 'Light 2',
  };
  return names[key] ?? `Button ${key}`;
}

/** Sorts buttons 1, 2, 10, then the letters. */
const byButton = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/** A device of the Discovery tab, from an entry of the registry (src/heard.js). */
export function heardDevice(gladys, entry) {
  const ids = gladys.externalIds(entry.family, entry.platformId);
  const params = [
    { name: 'PROTOCOL', value: entry.protocol },
    { name: 'ADDRESS', value: entry.address },
  ];
  let name;
  let features;
  if (entry.family === FAMILIES.SENSOR) {
    name = `${entry.model} ${entry.address}`;
    features = Object.values(MEASURES)
      .filter((spec) => entry.measures.includes(spec.key))
      .map(({ key, name: n, category, type, unit, min, max }) =>
        feature(ids, key, n, category, type, { unit, min, max }),
      );
  } else if (entry.family === FAMILIES.DETECTOR) {
    const detection = DETECTIONS[entry.detection];
    name = `${label(entry.protocol)} ${entry.address}`;
    features = [
      feature(ids, detection.key, detection.name, detection.category, T.SENSOR.BINARY),
      feature(ids, 'tamper', 'Tamper', C.TAMPER, T.TAMPER.BINARY),
    ];
  } else {
    const house = entry.packetType === PACKET.LIGHTING1 ? 'house ' : '';
    const kind = entry.packetType === PACKET.SECURITY1 ? '' : ' remote';
    name = `${label(entry.protocol)}${kind} ${house}${entry.address}`;
    features = [...entry.buttons].sort(byButton).map((key) =>
      feature(ids, `button-${key}`, buttonName(key), C.BUTTON, T.BUTTON.CLICK, {
        max: 100,
      }),
    );
  }
  return {
    name,
    external_id: ids.device,
    params,
    features: [...features, ...commonFeatures(ids, entry)],
  };
}

/** The feature key of a button. */
export const buttonKey = (button) => `button-${button}`;

/** A receiver declared by the user. */
export function actuatorDevice(gladys, actuator) {
  const ids = gladys.externalIds(ACTUATOR, actuator.platformId);
  const command = (key, name, category, type, extra = {}) =>
    feature(ids, key, name, category, type, { read_only: false, ...extra });
  let features;
  switch (actuator.kind) {
    case 'shutter':
      features = [
        command('state', 'State', C.SHUTTER, T.SHUTTER.STATE, {
          min: COVER_STATE.CLOSE,
          max: COVER_STATE.OPEN,
          keep_history: false,
        }),
      ];
      break;
    case 'dimmer':
      features = [
        command('binary', 'On/Off', C.LIGHT, T.LIGHT.BINARY),
        command('brightness', 'Brightness', C.LIGHT, T.LIGHT.BRIGHTNESS, {
          unit: U.PERCENT,
          max: 100,
          keep_history: false,
        }),
      ];
      break;
    case 'light':
      features = [command('binary', 'On/Off', C.LIGHT, T.LIGHT.BINARY)];
      break;
    default:
      features = [command('binary', 'On/Off', C.SWITCH, T.SWITCH.BINARY)];
  }
  return {
    name: actuator.name,
    external_id: ids.device,
    params: [
      { name: 'PROTOCOL', value: actuator.protocol },
      { name: 'ADDRESS', value: actuator.address },
    ],
    features,
  };
}
