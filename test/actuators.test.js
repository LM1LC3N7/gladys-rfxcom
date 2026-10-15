// -----------------------------------------------------------------------------
// The receivers declared in the configuration: parsing, addresses, orders.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatActuator,
  heardBy,
  kindsOf,
  makeActuator,
  orderPacket,
  pairingOrder,
  parseActuators,
  parseAddress,
  randomAddress,
} from '../src/actuators.js';
import { decodePacket } from '../src/protocol/decode.js';
import * as P from './fixtures/packets.js';

const bytes = (buffer) => [...buffer];
const actuator = (entry) => {
  const { actuators, errors } = parseActuators(entry);
  assert.deepEqual(errors, []);
  return actuators[0];
};

test('the configuration field is parsed, the bad entries reported', () => {
  const { actuators, errors } = parseActuators(
    [
      'Volet salon = shutter RFY 0x010203/1',
      ' Lampe bureau = dimmer ac 1a2b3c4/2 ',
      'Prise = switch X10 C14',
      'Blyss = light BLYSS F09A/B/1',
      'Garage = switch FOO 1/1',
      'nothing to see here',
      'Twice = switch X10 c14',
      'Volet = shutter AC 1/1',
      'Lampe = dimmer X10 A1',
      'Bad = switch AC 0/1',
      'Kind = gate AC 1/1',
      '',
    ].join(';\n'),
  );
  assert.deepEqual(
    actuators.map((a) => [a.name, a.kind, a.protocol, a.address, a.platformId]),
    [
      ['Volet salon', 'shutter', 'RFY', '10203/1', 'RFY-10203-1'],
      ['Lampe bureau', 'dimmer', 'AC', '1A2B3C4/2', 'AC-1A2B3C4-2'],
      ['Prise', 'switch', 'X10', 'C14', 'X10-C14'],
      ['Blyss', 'light', 'BLYSS', 'F09A/B/1', 'BLYSS-F09A-B-1'],
    ],
  );
  assert.deepEqual(
    errors.map((e) => e.error),
    ['protocol', 'syntax', 'duplicate', 'kind-protocol', 'kind-protocol', 'address', 'kind'],
  );
  assert.deepEqual(parseActuators(undefined), { actuators: [], errors: [] });
});

test('addresses follow the limits of each protocol', () => {
  assert.equal(parseAddress('X10', 'P16').address, 'P16');
  assert.equal(parseAddress('X10', 'A0').address, 'A0'); // all units
  assert.equal(parseAddress('X10', 'Q1'), null);
  assert.equal(parseAddress('X10', 'A17'), null);
  assert.equal(parseAddress('CHACON', 'D1'), null); // houses A-C
  assert.equal(parseAddress('CHACON', 'C4').address, 'C4');
  assert.equal(parseAddress('CHACON', 'C0'), null); // no "all" for Chacon EMW200
  assert.equal(parseAddress('AC', '3FFFFFF/16').address, '3FFFFFF/16');
  assert.equal(parseAddress('AC', '4000000/1'), null);
  assert.equal(parseAddress('AC', '1A2B3C4/0').address, '1A2B3C4/0'); // group
  assert.equal(parseAddress('AC', '1A2B3C4/17'), null);
  assert.equal(parseAddress('AC', '1A2B3C4'), null);
  assert.equal(parseAddress('EMW100', '4000/1'), null);
  assert.equal(parseAddress('LIGHTWAVERF', 'F09AC8/16').address, 'F09AC8/16');
  assert.equal(parseAddress('LIGHTWAVERF', 'F09AC8/0'), null);
  assert.equal(parseAddress('BLYSS', 'F09A/Q/1'), null);
  assert.equal(parseAddress('BLYSS', 'F09A/B/6'), null);
  assert.equal(parseAddress('RFY', 'FFFFF/4').address, 'FFFFF/4');
  assert.equal(parseAddress('RFY', 'FFFFF/5'), null);
  assert.equal(parseAddress('RFYEXT', '0x0FFFFF/15').address, 'FFFFF/15');
  assert.equal(parseAddress('RFY', '100000/1'), null);
  assert.equal(parseAddress('NOPE', '1/1'), null);
});

test('the kinds each protocol can drive', () => {
  assert.deepEqual(kindsOf('RFY'), ['shutter']);
  assert.deepEqual(kindsOf('AC'), ['switch', 'light', 'dimmer']);
  assert.deepEqual(kindsOf('X10'), ['switch', 'light']);
  assert.equal(
    makeActuator({ name: '', kind: 'switch', protocol: 'x10', address: 'a1' }).actuator.name,
    'X10 A1',
  );
});

test('orders become the packets of their protocol', () => {
  const at = (entry, order, state) => bytes(orderPacket(actuator(entry), order, state)(0));
  assert.deepEqual(
    at('Prise = switch X10 C14', 'on'),
    [0x07, 0x10, 0x00, 0x00, 0x43, 0x0e, 0x01, 0x00],
  );
  assert.deepEqual(
    at('Prises = switch X10 C0', 'off'),
    [0x07, 0x10, 0x00, 0x00, 0x43, 0x00, 0x05, 0x00],
  );
  assert.deepEqual(
    at('Lampe = switch ANSLUT 3FFFFFF/1', 'on'),
    [0x0b, 0x11, 0x02, 0x00, 0x03, 0xff, 0xff, 0xff, 0x01, 0x01, 0x0f, 0x00],
  );
  // A dimmer at 50 %: level 8 of 15; a group order goes out with unit 1.
  assert.deepEqual(
    at('Variateur = dimmer AC 39AC7A1/2', { level: 50 }),
    [0x0b, 0x11, 0x00, 0x00, 0x03, 0x9a, 0xc7, 0xa1, 0x02, 0x02, 0x08, 0x00],
  );
  assert.deepEqual(
    at('Tout = switch AC 39AC7A1/0', 'off'),
    [0x0b, 0x11, 0x00, 0x00, 0x03, 0x9a, 0xc7, 0xa1, 0x01, 0x03, 0x00, 0x00],
  );
  assert.deepEqual(
    at('LWRF = dimmer LIGHTWAVERF F09AC8/1', { level: 100 }),
    [0x0a, 0x14, 0x00, 0x00, 0xf0, 0x9a, 0xc8, 0x01, 0x10, 0x1f, 0x00],
  );
  assert.deepEqual(
    at('Blyss = switch BLYSS F09A/B/1', 'off', { rolling: 3 }),
    [0x0b, 0x15, 0x00, 0x00, 0xf0, 0x9a, 0x42, 0x01, 0x01, 0x03, 0x00, 0x00],
  );
  assert.deepEqual(
    at('Volet = shutter RFY 10203/1', 'down'),
    [0x0c, 0x1a, 0x00, 0x00, 0x01, 0x02, 0x03, 0x01, 0x03, 0x00, 0x00, 0x00, 0x00],
  );
  assert.deepEqual(
    at('Volet = shutter RFY 10203/1', 'stop'),
    [0x0c, 0x1a, 0x00, 0x00, 0x01, 0x02, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
  );
  assert.throws(() => orderPacket(actuator('Volet = shutter RFY 10203/1'), 'on'), /cannot do/);
  assert.throws(() => orderPacket(actuator('Prise = switch X10 C14'), { level: 50 }), /no level/);
  assert.throws(() => orderPacket(actuator('P = switch AC 1/1'), 'up'), /cannot do/);
});

test('pairing: a free address, the right order, the entry written back', () => {
  const random = () => 0.5;
  assert.match(randomAddress('AC', random), /^[0-9A-F]+\/1$/);
  assert.match(randomAddress('RFY', random), /^[0-9A-F]{5}\/1$/);
  assert.match(randomAddress('BLYSS', random), /^[0-9A-F]+\/A\/1$/);
  assert.match(randomAddress('LIGHTWAVERF', random), /^[0-9A-F]+\/1$/);
  assert.equal(randomAddress('X10', random), null);
  for (const protocol of ['AC', 'RFY', 'BLYSS', 'LIGHTWAVERF', 'IT']) {
    for (const r of [0, 0.999999]) {
      const kind = protocol === 'RFY' ? 'shutter' : 'switch';
      const made = makeActuator({
        name: 'x',
        kind,
        protocol,
        address: randomAddress(protocol, () => r),
      });
      assert.ok(made.actuator, `${protocol} ${r}`);
    }
  }
  const volet = actuator('Volet = shutter RFY 10203/1');
  assert.equal(pairingOrder(volet), 'program');
  assert.equal(pairingOrder(actuator('P = switch AC 1/1')), 'on');
  assert.equal(formatActuator(volet), 'Volet = shutter RFY 10203/1');
  assert.deepEqual(parseActuators(formatActuator(volet)).actuators[0], volet);
});

test('a remote heard speaks to the receivers paired with it', () => {
  const dio1 = actuator('Lampe = switch AC 39AC7A1/1');
  const dio2 = actuator('Lampe 2 = switch AC 39AC7A1/2');
  const other = actuator('Autre = switch AC 39AC7A2/1');
  const x10 = actuator('ARC = switch ARC D2');
  const blyss = actuator('Blyss = switch BLYSS F09A/K/4');
  assert.equal(heardBy(dio1, decodePacket(P.DIO_1_ON)), 'unit');
  assert.equal(heardBy(dio2, decodePacket(P.DIO_1_ON)), null);
  assert.equal(heardBy(dio2, decodePacket(P.DIO_GROUP_ON)), 'group');
  assert.equal(heardBy(other, decodePacket(P.DIO_1_ON)), null);
  assert.equal(heardBy(x10, decodePacket(P.ARC_D2_ON)), 'unit');
  assert.equal(heardBy(x10, decodePacket(P.DIO_1_ON)), null);
  assert.equal(heardBy(blyss, decodePacket(P.BLYSS_K4_ON)), 'unit');
});
