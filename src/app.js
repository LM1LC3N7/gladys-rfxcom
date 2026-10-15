// -----------------------------------------------------------------------------
// The integration: one link to the RFXtrx (through ser2net), the emitters
// heard on the air offered in the Discovery tab, their states, the remotes'
// presses (button features and the `remote_pressed` scene trigger), and the
// receivers the user declared, driven by radio. index.js only wires the SDK
// handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  formatActuator,
  heardBy,
  makeActuator,
  orderPacket,
  pairingOrder,
  randomAddress,
} from './actuators.js';
import { normalizeConfig } from './config.js';
import { COVER_STATE, LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import {
  ACTUATOR,
  FAMILIES,
  actuatorDevice,
  buttonKey,
  buttonValue,
  classify,
  heardDevice,
} from './devices.js';
import { HeardRegistry } from './heard.js';
import { T } from './i18n.js';
import { RfxLink } from './link.js';
import { PACKET } from './protocol/constants.js';
import { hex } from './protocol/frames.js';
import { StatePublisher } from './publisher.js';

const ON = ['on', 'group-on', 'all-on'];
const OFF = ['off', 'group-off', 'all-off'];

const withErrors = (message, errors) => {
  if (errors.length === 0) {
    return message;
  }
  const extra = T.actuatorErrors(errors);
  return { en: message.en + extra.en, fr: message.fr + extra.fr };
};

export class RfxcomApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'rfxcom' }),
    link,
    createSocket,
    heardFile = null,
    now = Date.now,
    timers = globalThis,
    timings = {},
    random = Math.random,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.random = random;
    this.timings = { ...TIMINGS, ...timings };
    this.link = link ?? new RfxLink({ createSocket, timings: this.timings, logger });
    this.heard = new HeardRegistry({ file: heardFile, now });
    this.publisher = new StatePublisher({
      gladys,
      logger,
      now,
      timers,
      flushInterval: this.timings.flushInterval,
    });
    this.rawConfig = {};
    this.config = normalizeConfig();
    /** device external id -> actuator */
    this.actuators = new Map();
    /** feature external id -> last state of an actuator */
    this.actuatorValues = new Map();
    this.createdDevices = new Set();
    this.createdFeatures = new Set();
    /** `${deviceId}|${button}` -> { command, level, at } */
    this.lastPress = new Map();
    /** featureId -> timer bringing a motion / smoke detection back to 0 */
    this.resetTimers = new Map();
    /** deviceId -> transport last published */
    this.transports = new Map();
    this.sceneEvents = [];
    this.rolling = 0;
    this.started = false;
    this.loaded = false;
    this.rebuildTimer = undefined;
    this.saveTimer = undefined;
    this.watchdogTimer = undefined;
    this.lastStatus = undefined;
    this.warned = new Set();

    const failed = (err) => this.logger.error(`RFXtrx event handling failed: ${err.stack ?? err}`);
    this.link.on('ready', () => this.onReady().catch(failed));
    this.link.on('down', (reason) => this.onDown(reason).catch(failed));
    this.link.on('event', (event) => {
      try {
        this.onEvent(event);
      } catch (err) {
        failed(err);
      }
    });
    this.link.on('unknown', (packet) =>
      this.debugOnce(
        `unknown:${packet[1]}`,
        `Packet type 0x${hex([packet[1]])} not decoded: ${hex(packet)}`,
      ),
    );
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Applies the configuration; the link only restarts when the bridge moved. */
  async applyConfig(raw = {}) {
    this.rawConfig = { ...(raw ?? {}) };
    this.config = normalizeConfig(raw);
    if (!this.loaded) {
      this.loaded = true;
      await this.heard
        .load()
        .catch((err) => this.logger.warn(`Reading the emitters heard failed: ${err.message}`));
    }
    if (!this.started) {
      this.started = true;
      this.publisher.start();
      this.watchdogTimer = this.timers.setInterval(() => this.watchdog(), this.timings.watchdog);
    }
    this.refreshCreated();
    this.actuators = new Map(
      this.config.actuators.map((a) => [this.gladys.externalIds(ACTUATOR, a.platformId).device, a]),
    );
    for (const { entry, error } of this.config.actuatorErrors) {
      this.warnOnce(`actuator:${entry}:${error}`, `Actuator "${entry}" ignored: ${error}`);
    }
    const { host, port, protocols, hostError } = this.config;
    this.link.configure({ host: hostError ? null : host, port, protocols });
    if (hostError) {
      this.link.stop();
      await this.setStatus(false, hostError === 'empty' ? T.notConfigured : T.badHost(hostError));
    } else {
      this.link.start();
      await this.setStatus(
        this.link.ready,
        this.link.ready ? this.connectedMessage() : T.connecting(this.link.address),
      );
    }
    await this.publishDevices();
    await this.publishAllTransports();
  }

  async stop() {
    this.started = false;
    this.link.stop();
    this.publisher.stop();
    this.timers.clearInterval(this.watchdogTimer);
    this.timers.clearTimeout(this.rebuildTimer);
    this.timers.clearTimeout(this.saveTimer);
    for (const timer of this.resetTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.resetTimers.clear();
    await this.heard
      .save({ force: true })
      .catch((err) => this.logger.warn(`Saving the emitters heard failed: ${err.message}`));
  }

  async setStatus(connected, message) {
    const full = withErrors(message, this.config.actuatorErrors);
    const key = JSON.stringify([connected, full]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, full)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  connectedMessage() {
    return T.connected(this.link.status, this.heard.size, this.actuators.size);
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  debugOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.debug(message);
    }
  }

  async onReady() {
    await this.setStatus(true, this.connectedMessage());
    await this.publishAllTransports();
  }

  async onDown(reason) {
    await this.setStatus(false, T.unreachable(this.link.address, reason));
    await this.publishAllTransports();
  }

  // --- Discovery -------------------------------------------------------------

  async publishDevices() {
    const devices = [
      ...this.heard.values().map((entry) => heardDevice(this.gladys, entry)),
      ...[...this.actuators.values()].map((a) => actuatorDevice(this.gladys, a)),
    ];
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the discovered devices failed: ${err.message}`));
  }

  scheduleRebuild() {
    this.timers.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = this.timers.setTimeout(async () => {
      this.rebuildTimer = undefined;
      if (!this.started) {
        return;
      }
      await this.publishDevices();
      if (this.link.ready) {
        // The status counts the emitters heard.
        await this.setStatus(true, this.connectedMessage());
      }
    }, this.timings.rebuildDebounce);
  }

  scheduleSave() {
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = this.timers.setTimeout(() => {
      this.saveTimer = undefined;
      this.heard
        .save()
        .catch((err) => this.logger.warn(`Saving the emitters heard failed: ${err.message}`));
    }, this.timings.saveDelay);
  }

  idsOf(entry) {
    return this.gladys.externalIds(entry.family, entry.platformId);
  }

  // --- Radio events ----------------------------------------------------------

  onEvent(event) {
    const reading = classify(event);
    if (!reading) {
      return;
    }
    const ids = this.idsOf(reading);
    if (reading.button && this.isRepeat(ids.device, reading.button)) {
      return;
    }
    if (event.type === 'lighting') {
      this.followActuators(event);
    }
    const known = this.heard.get(reading.family, reading.platformId);
    if (!known && reading.signal !== null && reading.signal < this.config.minSignal) {
      this.debugOnce(
        `far:${reading.platformId}`,
        `${reading.platformId} heard too far away: not offered`,
      );
      return;
    }
    const { entry, shapeChanged } = this.heard.record(reading, (e) =>
      this.createdDevices.has(this.idsOf(e).device),
    );
    if (shapeChanged) {
      this.scheduleRebuild();
      this.scheduleSave();
    }
    for (const [key, value] of Object.entries(reading.values)) {
      this.record(ids.feature(key), value);
    }
    if (reading.detected && reading.detection !== 'opening') {
      this.scheduleReset(entry, reading.detection);
    }
    if (reading.button) {
      this.onPress(ids, reading);
    }
    if (this.transports.get(ids.device) === DEVICE_TRANSPORTS.UNREACHABLE && this.link.ready) {
      this.publishTransport(ids.device);
    }
  }

  /** A remote repeats its frame: the same command within the window is one press. */
  isRepeat(deviceId, { key, command, level }) {
    const id = `${deviceId}|${key}`;
    const last = this.lastPress.get(id);
    const now = this.now();
    if (
      last &&
      last.command === command &&
      last.level === level &&
      now - last.at < this.timings.repeatWindow
    ) {
      last.at = now;
      return true;
    }
    this.lastPress.set(id, { command, level, at: now });
    return false;
  }

  /** Keeps the value, and sends it when the feature exists in Gladys. */
  record(featureId, state) {
    if (this.createdFeatures.has(featureId)) {
      this.publisher.push(featureId, state);
    }
  }

  /** Motion and smoke detectors never send "it is over": back to 0 after a while. */
  scheduleReset(entry, key) {
    const featureId = this.idsOf(entry).feature(key);
    this.timers.clearTimeout(this.resetTimers.get(featureId));
    this.resetTimers.set(
      featureId,
      this.timers.setTimeout(() => {
        this.resetTimers.delete(featureId);
        entry.values[key] = 0;
        this.record(featureId, 0);
      }, this.timings.detectionReset),
    );
  }

  onPress(ids, reading) {
    const { key, command, level } = reading.button;
    if (!this.createdDevices.has(ids.device)) {
      return;
    }
    const featureId = ids.feature(buttonKey(key));
    if (this.createdFeatures.has(featureId)) {
      this.publisher.pushEvent(featureId, buttonValue(command));
    }
    const now = this.now();
    this.sceneEvents = this.sceneEvents.filter((t) => now - t < 60_000);
    if (this.sceneEvents.length >= LIMITS.eventsPerMinute) {
      this.warnOnce(
        'scene-budget',
        'More than 250 remote presses in a minute: some scene events dropped',
      );
      return;
    }
    this.sceneEvents.push(now);
    this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.REMOTE_PRESSED, {
        device: ids.device,
        button: key,
        command,
        level,
        protocol: reading.protocol,
        address: reading.address,
      })
      .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
  }

  /** The user's own remote speaks to a declared receiver: its state follows. */
  followActuators(event) {
    for (const [deviceId, actuator] of this.actuators) {
      if (actuator.kind === 'shutter' || !heardBy(actuator, event)) {
        continue;
      }
      const ids = this.gladys.externalIds(ACTUATOR, actuator.platformId);
      if (ON.includes(event.command)) {
        this.recordActuator(ids.feature('binary'), 1);
      } else if (OFF.includes(event.command)) {
        this.recordActuator(ids.feature('binary'), 0);
      } else if (event.level !== null) {
        this.recordActuator(ids.feature('binary'), event.level > 0 ? 1 : 0);
        if (actuator.kind === 'dimmer') {
          this.recordActuator(ids.feature('brightness'), event.level);
        }
      }
      this.logger.debug(`${deviceId} follows its remote: ${event.command}`);
    }
  }

  recordActuator(featureId, state) {
    this.actuatorValues.set(featureId, state);
    this.record(featureId, state);
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    const actuator = this.actuators.get(device.external_id);
    if (!actuator) {
      throw new Error(
        `${device.name ?? device.external_id} is not declared in the actuators of the configuration`,
      );
    }
    const ids = this.gladys.externalIds(ACTUATOR, actuator.platformId);
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`Invalid value ${value}`);
    }
    let order;
    const states = {};
    switch (feature.external_id) {
      case ids.feature('binary'):
        order = number > 0 ? 'on' : 'off';
        states.binary = number > 0 ? 1 : 0;
        break;
      case ids.feature('brightness'): {
        const level = Math.max(0, Math.min(100, Math.round(number)));
        order = level === 0 ? 'off' : { level };
        states.brightness = level;
        states.binary = level > 0 ? 1 : 0;
        break;
      }
      case ids.feature('state'): {
        const state = Math.sign(number);
        order = { [COVER_STATE.OPEN]: 'up', [COVER_STATE.CLOSE]: 'down' }[state] ?? 'stop';
        states.state = state;
        break;
      }
      default:
        throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    await this.send(actuator, order);
    for (const [key, state] of Object.entries(states)) {
      if (key !== 'brightness' || actuator.kind === 'dimmer') {
        this.recordActuator(ids.feature(key), state);
      }
    }
  }

  async send(actuator, order) {
    let rolling = 0;
    if (actuator.packetType === PACKET.LIGHTING6) {
      rolling = this.rolling;
      this.rolling = (this.rolling + 1) % 5;
    }
    const build = orderPacket(actuator, order, { rolling });
    await this.link.transmit(build);
    this.logger.info(
      `Sent ${JSON.stringify(order)} to ${actuator.name} (${actuator.protocol} ${actuator.address})`,
    );
  }

  // --- Configuration screen buttons ------------------------------------------

  async testConnection() {
    const { hostError } = this.config;
    if (hostError) {
      return hostError === 'empty' ? T.notConfigured : T.badHost(hostError);
    }
    if (!this.link.ready) {
      return T.test.down(this.link.address, this.link.lastError);
    }
    const started = this.now();
    try {
      const status = await this.link.refreshStatus();
      return T.test.ok(status, this.now() - started, this.heard.size);
    } catch (err) {
      return T.test.down(this.link.address, { code: err.code ?? 'error', message: err.message });
    }
  }

  /** Sends the pairing frame of a new receiver and adds it to the configuration. */
  async pairActuator(fields = {}) {
    const protocol = String(fields.protocol ?? '').toUpperCase();
    let address = String(fields.address ?? '').trim();
    if (address === '') {
      address = randomAddress(protocol, this.random);
      if (!address) {
        return T.pair.needsAddress;
      }
    }
    // "=" and ";" belong to the syntax of the Actuators field.
    const name = String(fields.name ?? '')
      .replace(/[=;\s]+/g, ' ')
      .trim();
    const result = makeActuator({ name, kind: fields.kind, protocol, address });
    if (result.error) {
      return T.pair.invalid(result.error);
    }
    const { actuator } = result;
    const sendPairing = fields.send_pairing !== false;
    if (sendPairing) {
      if (!this.link.ready) {
        return T.pair.notConnected;
      }
      try {
        await this.send(actuator, pairingOrder(actuator));
      } catch (err) {
        return T.pair.failed(err.message);
      }
    }
    const entry = formatActuator(actuator);
    if (this.config.actuators.some((a) => a.platformId === actuator.platformId)) {
      return sendPairing ? T.pair.already(entry) : T.pair.invalid('duplicate');
    }
    const actuators = [this.config.actuatorsText.trim().replace(/;+$/, '').trim(), entry]
      .filter(Boolean)
      .join('; ');
    await this.gladys.setConfig({ actuators });
    await this.applyConfig({ ...this.rawConfig, actuators });
    return T.pair.done(entry, sendPairing);
  }

  // --- Devices created by the user -------------------------------------------

  refreshCreated() {
    const devices = this.gladys.devices ?? [];
    this.createdDevices = new Set(devices.map((d) => d.external_id));
    this.createdFeatures = new Set(
      devices.flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** The entry of the registry or the actuator behind a device external id. */
  sourceOf(deviceId) {
    if (this.actuators.has(deviceId)) {
      return { actuator: this.actuators.get(deviceId) };
    }
    const entry = this.heard.values().find((e) => this.idsOf(e).device === deviceId);
    return entry ? { entry } : null;
  }

  async deviceCreated(device) {
    this.refreshCreated();
    const deviceId = device?.external_id;
    const source = deviceId ? this.sourceOf(deviceId) : null;
    if (!source) {
      return;
    }
    this.transports.delete(deviceId);
    if (source.entry) {
      const ids = this.idsOf(source.entry);
      for (const [key, state] of Object.entries(source.entry.values)) {
        this.record(ids.feature(key), state);
      }
    } else {
      for (const f of device.features ?? []) {
        if (this.actuatorValues.has(f.external_id)) {
          this.record(f.external_id, this.actuatorValues.get(f.external_id));
        }
      }
    }
    await this.publishTransport(deviceId).catch(() => {});
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    const deviceId = device?.external_id;
    if (!deviceId) {
      return;
    }
    this.transports.delete(deviceId);
    this.publisher.forget(deviceId);
    const source = this.sourceOf(deviceId);
    if (source?.entry) {
      // Out of the Discovery tab too, until it is heard again.
      this.heard.forget(source.entry.family, source.entry.platformId);
      this.scheduleRebuild();
      this.scheduleSave();
    }
  }

  // --- Transport badge -------------------------------------------------------

  transportOf(deviceId) {
    if (!this.link.ready) {
      return DEVICE_TRANSPORTS.UNREACHABLE;
    }
    const source = this.sourceOf(deviceId);
    if (source?.entry?.family === FAMILIES.SENSOR) {
      const silent = this.now() - (source.entry.lastSeen ?? 0) > this.timings.sensorSilence;
      return silent ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    }
    return DEVICE_TRANSPORTS.LOCAL;
  }

  async publishTransport(deviceId) {
    if (!this.createdDevices.has(deviceId) || !this.sourceOf(deviceId)) {
      return;
    }
    const transport = this.transportOf(deviceId);
    if (this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys
      .publishTransports([{ external_id: deviceId, transport }])
      .catch((err) => this.logger.warn(`Transport badge failed: ${err.message}`));
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices) {
      if (!this.sourceOf(deviceId)) {
        continue;
      }
      const transport = this.transportOf(deviceId);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** Every minute: silent sensors, and the presses too old to be repeats. */
  watchdog() {
    const now = this.now();
    for (const [id, press] of this.lastPress) {
      if (now - press.at > this.timings.repeatWindow) {
        this.lastPress.delete(id);
      }
    }
    this.publishAllTransports().catch(() => {});
  }
}
