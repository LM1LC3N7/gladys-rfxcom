// -----------------------------------------------------------------------------
// Radio events -> Gladys devices. The devices are checked by the fake Gladys
// of the SDK, which refuses what Gladys refuses (category, type, unit).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { parseActuators } from '../src/actuators.js';
import { BUTTON_STATUS, OPENING_SENSOR_STATE } from '../src/constants.js';
import { actuatorDevice, buttonValue, classify, heardDevice, signalBars } from '../src/devices.js';
import { HeardRegistry } from '../src/heard.js';
import { decodePacket } from '../src/protocol/decode.js';
import * as P from './fixtures/packets.js';

const read = (packet) => classify(decodePacket(packet));

/** The registry entries of some packets, as the app builds them. */
function entries(...packets) {
  const registry = new HeardRegistry({ now: () => 1000 });
  for (const packet of packets) {
    registry.record(read(packet));
  }
  return registry.values();
}

test('a sensor reading: values, battery and signal', () => {
  assert.deepEqual(read(P.TH_THGN122), {
    platformId: '52-01-9A01',
    packetType: 0x52,
    subtype: 1,
    address: '9A01',
    measures: ['temperature', 'humidity'],
    values: { temperature: 21, humidity: 58, battery: 100, signal: 2 },
    battery: 100,
    signal: 6,
    tamper: null,
    family: 'sensor',
    protocol: 'Oregon THGN122/THGR122',
    model: 'Oregon THGN122/THGR122',
  });
  // The phases of an OWL CM180i only count once they carry a current.
  const owl = read(P.OWL_CM180I);
  assert.deepEqual(owl.measures, ['current-1', 'energy']);
  assert.equal(owl.values['current-2'], 0);
  assert.equal(signalBars(0), 0);
  assert.equal(signalBars(15), 5);
});

test('detectors: opening uses the Gladys convention, motion and smoke are binary', () => {
  const open = read(P.X10_DOOR_OPEN);
  assert.equal(open.family, 'detector');
  assert.equal(open.detection, 'opening');
  assert.equal(open.values.opening, OPENING_SENSOR_STATE.OPEN);
  assert.equal(read(P.X10_DOOR_CLOSED).values.opening, OPENING_SENSOR_STATE.CLOSE);
  const motion = read(P.VISONIC_MOTION);
  assert.equal(motion.detection, 'motion');
  assert.deepEqual(motion.values, { motion: 1, tamper: 1, battery: 100, signal: 2 });
  assert.equal(motion.detected, true);
  assert.equal(read(P.KD101_SMOKE).values.smoke, 1);
});

test('remotes and keyfobs become button readings', () => {
  assert.deepEqual(read(P.DIO_1_ON).button, { key: '1', command: 'on', level: null });
  assert.equal(read(P.DIO_1_ON).family, 'remote');
  assert.deepEqual(read(P.DIO_1_ON).values, {}); // no signal feature on remotes
  const keyfob = read(P.X10_KEYFOB_ARM);
  assert.equal(keyfob.family, 'remote');
  assert.deepEqual(keyfob.button, { key: 'alarm', command: 'arm-away', level: null });
  assert.equal(buttonValue('on'), BUTTON_STATUS.ON);
  assert.equal(buttonValue('group-off'), BUTTON_STATUS.OFF);
  assert.equal(buttonValue('arm-away'), BUTTON_STATUS.ARM_ALL_ZONES);
  assert.equal(buttonValue('mood-2'), BUTTON_STATUS.CLICK);
  assert.equal(classify(decodePacket(P.STATUS_EXT)), null);
});

test('the devices of the Discovery tab pass the checks of Gladys', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const heard = entries(
    P.TH_THGN122,
    P.TEMP_NEGATIVE,
    P.THB_BTHR968,
    P.RAIN_PCR800,
    P.WIND_WGR800,
    P.UV_UVN128,
    P.OWL_CM119,
    P.OWL_CM180I,
    P.X10_DOOR_OPEN,
    P.VISONIC_MOTION,
    P.KD101_SMOKE,
    P.X10_KEYFOB_ARM,
    P.DIO_1_ON,
    P.DIO_GROUP_ON,
    P.ARC_D2_ON,
    P.LWRF_OFF,
    P.BLYSS_K4_ON,
  );
  const { actuators } = parseActuators(
    'V = shutter RFY 10203/1; D = dimmer AC 1A2B3C4/2; L = light X10 A1; S = switch BLYSS F09A/B/1',
  );
  const devices = [
    ...heard.map((e) => heardDevice(gladys, e)),
    ...actuators.map((a) => actuatorDevice(gladys, a)),
  ];
  await gladys.publishDiscoveredDevices(devices);
  const byId = Object.fromEntries(gladys.fake.discoveredDevices.map((d) => [d.external_id, d]));
  const features = (id) =>
    byId[`ext:test-integration:${id}`].features.map((f) => f.external_id.split(':').pop());

  const thgn = byId['ext:test-integration:sensor:52-01-9A01'];
  assert.equal(thgn.name, 'Oregon THGN122/THGR122 9A01');
  assert.deepEqual(thgn.params, [
    { name: 'PROTOCOL', value: 'Oregon THGN122/THGR122' },
    { name: 'ADDRESS', value: '9A01' },
  ]);
  assert.deepEqual(features('sensor:52-01-9A01'), ['temperature', 'humidity', 'battery', 'signal']);
  assert.deepEqual(features('sensor:50-01-FAAF'), ['temperature', 'signal']); // no battery level
  assert.deepEqual(features('sensor:54-02-E900'), [
    'temperature',
    'humidity',
    'pressure',
    'battery',
    'signal',
  ]);
  assert.deepEqual(features('sensor:56-02-2F00'), [
    'wind-direction',
    'wind-speed',
    'wind-gust',
    'battery',
    'signal',
  ]);
  assert.deepEqual(features('sensor:5A-01-1A73'), ['power', 'energy', 'battery', 'signal']);
  assert.deepEqual(features('detector:20-05-D81540'), ['motion', 'tamper', 'battery', 'signal']);
  assert.equal(byId['ext:test-integration:detector:20-00-FF00'].name, 'X10 door sensor FF00');
  // One remote, one button per button heard; the keyfob keeps its battery.
  assert.deepEqual(features('remote:11-00-39AC7A1'), ['button-1', 'button-group']);
  assert.equal(
    byId['ext:test-integration:remote:11-00-39AC7A1'].name,
    'Chacon DiO / KlikAanKlikUit remote 39AC7A1',
  );
  assert.equal(byId['ext:test-integration:remote:10-01-D'].name, 'ARC remote house D');
  assert.deepEqual(features('remote:15-00-F09A'), ['button-K4']);
  assert.deepEqual(features('remote:20-02-1256'), ['button-alarm', 'battery']);
  // Actuators.
  assert.deepEqual(features('actuator:RFY-10203-1'), ['state']);
  assert.deepEqual(features('actuator:AC-1A2B3C4-2'), ['binary', 'brightness']);
  const shutter = byId['ext:test-integration:actuator:RFY-10203-1'].features[0];
  assert.equal(shutter.read_only, false);
  assert.equal(shutter.min, -1);
  assert.equal(shutter.max, 1);
  assert.equal(byId['ext:test-integration:actuator:X10-A1'].features[0].category, 'light');
  assert.equal(byId['ext:test-integration:actuator:BLYSS-F09A-B-1'].features[0].category, 'switch');
});
