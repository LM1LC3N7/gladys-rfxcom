// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake RFXtrx behind a fake ser2net (a TCP server on the
// loopback interface). The timings are shortened; nothing leaves the process.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { RfxcomApp } from '../src/app.js';
import { ACTIONS, BUTTON_STATUS, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import * as P from './fixtures/packets.js';
import { FakeRfxtrx, waitFor } from './helpers/fakeRfxtrx.js';

const FAST = {
  resetDelay: 10,
  commandTimeout: 300,
  transmitTimeout: 300,
  reconnectBase: 20,
  reconnectMax: 100,
  rebuildDebounce: 10,
  flushInterval: 10,
  repeatWindow: 300,
  detectionReset: 150,
  saveDelay: 20,
};
const silent = createLogger({ level: 'silent' });
const ID = (suffix) => `ext:test-integration:${suffix}`;
const THGN = ID('sensor:52-01-9A01');
const DIO = ID('remote:11-00-39AC7A1');
const LAMP = ID('actuator:AC-39AC7A1-1');
const SHUTTER = ID('actuator:RFY-10203-1');

async function setup(t, { config = {}, rfx = {}, timings = {} } = {}) {
  const rfxtrx = await new FakeRfxtrx(rfx).listen();
  const gladys = createFakeGladys({
    config: { host: '10.0.0.5', port: rfxtrx.port, ...config },
  });
  const app = new RfxcomApp({
    gladys,
    logger: silent,
    // The bridge "10.0.0.5" is the fake one, on the loopback interface.
    createSocket: ({ port }) => net.createConnection({ host: '127.0.0.1', port }),
    timings: { ...FAST, ...timings },
  });
  registerHandlers(gladys, app, silent);
  await gladys.connect();
  t.after(async () => {
    await app.stop();
    await rfxtrx.close();
  });
  return { gladys, app, rfxtrx };
}

const ready = (ctx) =>
  waitFor(() => ctx.gladys.fake.connectionStatus?.connected, { message: 'ready' });
const discovered = (gladys, id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
const create = async (gladys, id) => {
  const device = await waitFor(() => discovered(gladys, id), { message: id });
  await gladys.fake.deviceCreated(device);
  return device;
};
const feature = (device, key) =>
  device.features.find((f) => f.external_id === `${device.external_id}:${key}`);

test('handshake: reset, status, set mode with the protocols chosen, start receiver', async (t) => {
  const ctx = await setup(t, { config: { receiver_protocols: ['OREGON', 'AC', 'X10'] } });
  await ready(ctx);
  assert.deepEqual(ctx.rfxtrx.commands, [0x00, 0x02, 0x03, 0x07]);
  const setMode = ctx.rfxtrx.received.find((p) => p[1] === 0x00 && p[4] === 0x03);
  assert.deepEqual(setMode.slice(5, 11), [0x53, 0x1c, 0x00, 0x00, 0x25, 0x00]);
  const status = ctx.gladys.fake.connectionStatus;
  assert.match(status.message.en, /433\.92 MHz transceiver, firmware 1094 Ext/);
  assert.match(status.message.en, /protocols received: X10, AC, OREGON/);
  assert.match(status.message.fr, /Connecté au RFXtrx/);
});

test('an old firmware: no start receiver, protocols left as they are', async (t) => {
  const ctx = await setup(t, { rfx: { oldFirmware: true } });
  await ready(ctx);
  assert.deepEqual(ctx.rfxtrx.commands, [0x00, 0x02]);
});

test('sensors heard go to Discovery; their values flow once the device is created', async (t) => {
  const ctx = await setup(t);
  const { gladys, rfxtrx } = ctx;
  await ready(ctx);
  rfxtrx.send(P.TH_THGN122);
  rfxtrx.send(Buffer.concat([P.OWL_CM119, P.X10_DOOR_OPEN]));
  await waitFor(() => gladys.fake.discoveredDevices.length === 3, { message: '3 devices' });
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  const thgn = await create(gladys, THGN);
  await waitFor(() => gladys.fake.lastState(`${THGN}:temperature`) === 21);
  assert.equal(gladys.fake.lastState(`${THGN}:humidity`), 58);
  assert.equal(gladys.fake.lastState(`${THGN}:battery`), 100);
  assert.equal(gladys.fake.lastState(`${THGN}:signal`), 2);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: thgn.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });

  // A new reading is published, an unchanged one is not sent again.
  const before = gladys.fake.states.length;
  rfxtrx.send(P.TH_THGN122);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(gladys.fake.states.length, before);

  // The door sensor: open is 0 in Gladys.
  await create(gladys, ID('detector:20-00-FF00'));
  await waitFor(() => gladys.fake.lastState(ID('detector:20-00-FF00:opening')) === 0);
  rfxtrx.send(P.X10_DOOR_CLOSED);
  await waitFor(() => gladys.fake.lastState(ID('detector:20-00-FF00:opening')) === 1);
});

test('a motion is back to 0 after a while', async (t) => {
  const ctx = await setup(t);
  await ready(ctx);
  ctx.rfxtrx.send(P.VISONIC_MOTION);
  await create(ctx.gladys, ID('detector:20-05-D81540'));
  const motion = ID('detector:20-05-D81540:motion');
  ctx.rfxtrx.send(P.VISONIC_MOTION);
  await waitFor(() => ctx.gladys.fake.lastState(motion) === 1);
  await waitFor(() => ctx.gladys.fake.lastState(motion) === 0, { message: 'motion reset' });
  assert.equal(ctx.gladys.fake.lastState(ID('detector:20-05-D81540:tamper')), 1);
});

test('a remote: one press is one button state and one scene event', async (t) => {
  const ctx = await setup(t);
  const { gladys, rfxtrx } = ctx;
  await ready(ctx);
  rfxtrx.send(P.DIO_1_ON);
  const remote = await create(gladys, DIO);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'no trigger before the device is created');

  // The remote repeats its frame: one press.
  rfxtrx.send(P.DIO_1_OFF);
  rfxtrx.send(P.DIO_1_OFF);
  await waitFor(() => gladys.fake.sceneEvents.length === 1);
  assert.deepEqual(gladys.fake.sceneEvents[0], {
    key: SCENE_TRIGGERS.REMOTE_PRESSED,
    data: {
      device: DIO,
      button: '1',
      command: 'off',
      level: null,
      protocol: 'AC',
      address: '39AC7A1',
    },
  });
  const button = feature(remote, 'button-1').external_id;
  await waitFor(() => gladys.fake.lastState(button) === BUTTON_STATUS.OFF);

  // Pressed again after the repeat window: sent again, even though equal.
  await new Promise((resolve) => setTimeout(resolve, FAST.repeatWindow + 50));
  rfxtrx.send(P.DIO_1_OFF);
  await waitFor(() => gladys.fake.sceneEvents.length === 2);
  await waitFor(
    () => gladys.fake.states.filter((s) => s.device_feature_external_id === button).length === 2,
    { message: 'two presses' },
  );

  // A new button of the same remote: the device gains a feature in Discovery.
  rfxtrx.send(P.DIO_GROUP_ON);
  await waitFor(() => feature(discovered(gladys, DIO), 'button-group'));
});

test('declared actuators: commands go out on the air, states follow', async (t) => {
  const ctx = await setup(t, {
    config: { actuators: 'Lampe = switch AC 39AC7A1/1; Volet = shutter RFY 10203/1' },
  });
  const { gladys, rfxtrx } = ctx;
  await ready(ctx);
  const lamp = await create(gladys, LAMP);
  const shutter = await create(gladys, SHUTTER);

  const on = await gladys.fake.setValue(lamp, feature(lamp, 'binary'), 1);
  assert.equal(on.success, true);
  assert.deepEqual(
    rfxtrx.transmitted.at(-1),
    [0x0b, 0x11, 0x00, 0x00, 0x03, 0x9a, 0xc7, 0xa1, 0x01, 0x01, 0x0f, 0x00],
  );
  await waitFor(() => gladys.fake.lastState(`${LAMP}:binary`) === 1);

  for (const [value, command] of [
    [-1, 0x03],
    [0, 0x00],
    [1, 0x01],
  ]) {
    assert.equal(
      (await gladys.fake.setValue(shutter, feature(shutter, 'state'), value)).success,
      true,
    );
    assert.equal(rfxtrx.transmitted.at(-1)[8], command);
  }
  await waitFor(() => gladys.fake.lastState(`${SHUTTER}:state`) === 1);

  // The user's own remote switches the lamp off: Gladys follows.
  rfxtrx.send(P.DIO_1_OFF);
  await waitFor(() => gladys.fake.lastState(`${LAMP}:binary`) === 0);

  // A transmission refused by the RFXtrx is a failed command.
  rfxtrx.refuse = true;
  const refused = await gladys.fake.setValue(lamp, feature(lamp, 'binary'), 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /refused to transmit/);
});

test('a dimmer: brightness levels, 0 switches it off', async (t) => {
  const ctx = await setup(t, { config: { actuators: 'Salon = dimmer AC 39AC7A1/1' } });
  const { gladys, rfxtrx } = ctx;
  await ready(ctx);
  const dimmer = await create(gladys, LAMP);
  await gladys.fake.setValue(dimmer, feature(dimmer, 'brightness'), 40);
  assert.deepEqual(rfxtrx.transmitted.at(-1).slice(8, 11), [0x01, 0x02, 0x06]);
  await waitFor(() => gladys.fake.lastState(`${LAMP}:brightness`) === 40);
  await gladys.fake.setValue(dimmer, feature(dimmer, 'brightness'), 0);
  assert.deepEqual(rfxtrx.transmitted.at(-1).slice(8, 11), [0x01, 0x00, 0x00]);
  await waitFor(() => gladys.fake.lastState(`${LAMP}:binary`) === 0);
  // The remote sets a level: the dimmer follows.
  rfxtrx.send(P.DIO_1_LEVEL);
  await waitFor(() => gladys.fake.lastState(`${LAMP}:brightness`) === 67);
});

test('pairing an actuator: the frame goes out, the configuration grows', async (t) => {
  const ctx = await setup(t, { config: { actuators: 'Lampe = switch AC 39AC7A1/1' } });
  const { gladys, rfxtrx, app } = ctx;
  await ready(ctx);
  app.random = () => 0;
  const ack = await gladys.fake.action(ACTIONS.PAIR, {
    name: 'Volet; cuisine',
    kind: 'shutter',
    protocol: 'RFY',
    address: '',
    send_pairing: true,
  });
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /Pairing frame sent and actuator added: "Volet cuisine = shutter RFY 10000\/1"/,
  );
  assert.deepEqual(
    rfxtrx.transmitted.at(-1),
    [0x0c, 0x1a, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00],
  );
  assert.equal(
    gladys.fake.config.actuators,
    'Lampe = switch AC 39AC7A1/1; Volet cuisine = shutter RFY 10000/1',
  );
  await waitFor(() => discovered(gladys, ID('actuator:RFY-10000-1')));

  const x10 = await gladys.fake.action(ACTIONS.PAIR, {
    name: 'X',
    kind: 'switch',
    protocol: 'X10',
  });
  assert.match(x10.data.message.en, /needs the address/);
  const bad = await gladys.fake.action(ACTIONS.PAIR, {
    name: 'X',
    kind: 'dimmer',
    protocol: 'X10',
    address: 'A1',
  });
  assert.match(bad.data.message.fr, /ce protocole ne pilote pas ce type/);
  const declareOnly = await gladys.fake.action(ACTIONS.PAIR, {
    name: 'Module',
    kind: 'light',
    protocol: 'X10',
    address: 'B3',
    send_pairing: false,
  });
  assert.match(declareOnly.data.message.en, /^Actuator added/);
  assert.match(gladys.fake.config.actuators, /Module = light X10 B3$/);
});

test('the connection test, and a bridge whose RFXtrx does not answer', async (t) => {
  const ok = await setup(t);
  await ready(ok);
  ok.rfxtrx.send(P.TH_THGN122);
  await waitFor(() => ok.gladys.fake.discoveredDevices.length === 1);
  const ack = await ok.gladys.fake.action(ACTIONS.TEST);
  assert.match(ack.data.message.en, /^Connection OK: 433\.92 MHz transceiver.*1 emitter heard/);

  const mute = await setup(t, { rfx: { silent: true } });
  await waitFor(() => mute.gladys.fake.connectionStatus?.message?.en?.includes('not the RFXtrx'), {
    message: 'no answer status',
  });
  assert.equal(mute.gladys.fake.connectionStatus.connected, false);
  const down = await mute.gladys.fake.action(ACTIONS.TEST);
  assert.match(down.data.message.en, /^Not connected: the bridge .* answers, but not the RFXtrx/);
});

test('the bridge drops the connection: badges go unreachable, then come back', async (t) => {
  const ctx = await setup(t, { config: { actuators: 'Volet = shutter RFY 10203/1' } });
  const { gladys, rfxtrx } = ctx;
  await ready(ctx);
  await create(gladys, SHUTTER);
  await waitFor(() => gladys.fake.transports.at(-1)?.transport === DEVICE_TRANSPORTS.LOCAL);
  rfxtrx.drop();
  await waitFor(() => gladys.fake.transports.at(-1)?.transport === DEVICE_TRANSPORTS.UNREACHABLE);
  assert.match(gladys.fake.connectionStatuses.at(-1).message.en, /RFXtrx unreachable|Connecting/);
  await waitFor(() => rfxtrx.connections === 2 && gladys.fake.connectionStatus.connected);
  await waitFor(() => gladys.fake.transports.at(-1)?.transport === DEVICE_TRANSPORTS.LOCAL);
  // A command while the link is down fails cleanly.
  ctx.app.link.stop();
  const shutter = discovered(gladys, SHUTTER);
  const ack = await gladys.fake.setValue(shutter, feature(shutter, 'state'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /not connected/);
});

test('configuration: no host, localhost, a bad actuator, a new address', async (t) => {
  const ctx = await setup(t, { config: { host: '' } });
  const { gladys } = ctx;
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Type the address of the ser2net bridge/);
  await gladys.fake.configUpdated({ host: 'localhost', port: ctx.rfxtrx.port });
  assert.match(gladys.fake.connectionStatus.message.fr, /localhost désigne le conteneur/);
  await gladys.fake.configUpdated({
    host: '10.0.0.5',
    port: ctx.rfxtrx.port,
    actuators: 'Oops = switch AC nope',
  });
  await ready(ctx);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Ignored actuators: "Oops = switch AC nope" \(invalid address\)/,
  );
  // The same address again: the link is not restarted.
  await gladys.fake.configUpdated({ host: '10.0.0.5', port: ctx.rfxtrx.port, min_signal: 4 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(ctx.rfxtrx.connections, 1);
  // A far emitter is not offered.
  ctx.rfxtrx.send(P.THB_BTHR968); // RSSI 3
  ctx.rfxtrx.send(P.TEMP_NEGATIVE); // RSSI 9
  await waitFor(() => gladys.fake.discoveredDevices.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [ID('sensor:50-01-FAAF')],
  );
});
