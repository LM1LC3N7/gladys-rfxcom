// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their scenes and
// configuration), the value enums of Gladys and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
  PAIR: 'pair_actuator',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  REMOTE_PRESSED: 'remote_pressed',
};

/**
 * Value enums of Gladys core (server/utils/constants.js), which the SDK does
 * not export.
 */
export const BUTTON_STATUS = {
  CLICK: 1,
  ON: 7,
  OFF: 8,
  BRIGHTNESS_MOVE_DOWN: 9,
  BRIGHTNESS_MOVE_UP: 10,
  RELEASE: 20,
  EMERGENCY: 35,
  DISARM: 36,
  ARM_DAY_ZONES: 37,
  ARM_ALL_ZONES: 38,
};
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };

/** Default TCP port of the bridge (ser2net example of the documentation). */
export const DEFAULT_PORT = 4001;

/** Where the emitters heard are kept between two restarts. */
export const HEARD_FILE = '/data/rfxcom-heard.json';

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin. */
  statesPerMinute: 250,
  /** Gladys accepts 300 scene events per minute. */
  eventsPerMinute: 250,
  /** Emitters remembered (the neighbours' probes are heard too). */
  heard: 200,
};

export const TIMINGS = {
  /** Wait after the reset command, then drop what the RFXtrx sent meanwhile. */
  resetDelay: 500,
  /** An interface command (status, set mode, start receiver) must answer within. */
  commandTimeout: 5000,
  /** A transmission must be acknowledged within (RFY can be slow). */
  transmitTimeout: 5000,
  /** The RFXtrx is asked its status this often: a bridge keeps its port open without it. */
  keepAlive: 5 * 60_000,
  connectTimeout: 10_000,
  reconnectBase: 2000,
  reconnectMax: 60_000,
  /** Events heard arrive in bursts (a remote repeats its frame): wait before publishing devices. */
  rebuildDebounce: 1500,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** The same button heard again within this window is the same press. */
  repeatWindow: 1000,
  /** Motion and smoke detectors never say "it is over": back to 0 after. */
  detectionReset: 90_000,
  /** A sensor silent for this long is shown unreachable. */
  sensorSilence: 60 * 60_000,
  /** How often the silent sensors are looked for. */
  watchdog: 60_000,
  /** The emitters heard are saved this long after a change. */
  saveDelay: 30_000,
};
