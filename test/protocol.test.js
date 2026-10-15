// -----------------------------------------------------------------------------
// The RFXtrx protocol: the stream cut into packets, the packets decoded, the
// commands encoded. The encoder expectations are the bytes the tests of
// node-rfxcom expect, sequence number 0.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePacket } from '../src/protocol/decode.js';
import {
  lighting1Packet,
  lighting2Packet,
  lighting5Packet,
  lighting6Packet,
  resetPacket,
  rfyPacket,
  setModePacket,
  startReceiverPacket,
  statusPacket,
} from '../src/protocol/encode.js';
import { PacketSplitter, hex } from '../src/protocol/frames.js';
import * as P from './fixtures/packets.js';

const bytes = (buffer) => [...buffer];

test('the stream is cut into packets, whatever the chunks', () => {
  const splitter = new PacketSplitter();
  const stream = Buffer.concat([P.TH_THGN122, P.DIO_1_ON, P.OWL_CM119]);
  assert.deepEqual(
    splitter.push(stream).map(bytes),
    [P.TH_THGN122, P.DIO_1_ON, P.OWL_CM119].map(bytes),
  );
  // One byte at a time.
  const out = [];
  for (const b of P.THB_BTHR968) {
    out.push(...splitter.push(Buffer.from([b])));
  }
  assert.deepEqual(out.map(bytes), [bytes(P.THB_BTHR968)]);
  // Split in the middle, with the start of the next packet.
  assert.deepEqual(
    splitter.push(Buffer.concat([P.UV_UVN128, P.ARC_D2_ON.subarray(0, 3)])).length,
    1,
  );
  assert.deepEqual(splitter.push(P.ARC_D2_ON.subarray(3)).map(bytes), [bytes(P.ARC_D2_ON)]);
});

test('a stream out of step is dropped, the next chunk starts afresh', () => {
  const splitter = new PacketSplitter();
  assert.deepEqual(splitter.push(Buffer.from([0x02, 0x11, 0x00, 0xff, 0xee])), []);
  assert.equal(splitter.dropped, 5);
  assert.deepEqual(splitter.push(P.ARC_D2_ON).map(bytes), [bytes(P.ARC_D2_ON)]);
  splitter.push(P.ARC_D2_ON.subarray(0, 4));
  splitter.reset();
  assert.deepEqual(splitter.push(P.UV_UVN128).map(bytes), [bytes(P.UV_UVN128)]);
  assert.equal(hex([0x0a, 0xff]), '0A FF');
});

test('status answers: current and old firmwares', () => {
  assert.deepEqual(decodePacket(P.STATUS_EXT), {
    type: 'status',
    seq: 1,
    command: 2,
    receiverType: 0x53,
    receiverName: '433.92 MHz transceiver',
    firmwareVersion: 1094,
    firmwareType: 'Ext',
    hardwareVersion: '1.1',
    protocols: ['LIGHTING4', 'LIGHTWAVERF', 'X10', 'AC', 'OREGON'],
    protocolBytes: [0x08, 0x02, 0x25, 0x00],
    needsStartReceiver: true,
  });
  const old = decodePacket(P.STATUS_OLD);
  assert.equal(old.firmwareVersion, 0x30);
  assert.equal(old.firmwareType, null);
  assert.equal(old.needsStartReceiver, false);
  assert.deepEqual(old.protocols, ['LIGHTWAVERF', 'X10', 'OREGON', 'KEELOQ']);
  assert.deepEqual(decodePacket(P.COPYRIGHT), {
    type: 'receiver-started',
    seq: 2,
    text: 'Copyright RFXCOM',
  });
});

test('transmitter answers', () => {
  assert.deepEqual(decodePacket(P.TX_ACK(7)), {
    type: 'tx-response',
    seq: 7,
    ok: true,
    code: 0,
    message: 'transmit OK',
  });
  const nak = decodePacket(P.TX_NAK(8));
  assert.equal(nak.ok, false);
  assert.match(nak.message, /did not lock/);
  // Subtype 0x00: the receiver did not lock.
  assert.equal(decodePacket(Buffer.from([0x04, 0x02, 0x00, 9, 0x00])).ok, false);
});

test('garbage and unknown packet types decode to null', () => {
  assert.equal(decodePacket(Buffer.from([0x05, 0x50, 0x01])), null); // length byte lies
  assert.equal(decodePacket(Buffer.from([0x04, 0x13, 0x00, 0x00, 0x00])), null); // Lighting4
  assert.equal(decodePacket(Buffer.from([0x07, 0x10, 0x00, 0x01, 0x41, 0x01, 0xff, 0x70])), null);
});

test('Lighting1, Lighting2, Lighting5 and Lighting6 remotes', () => {
  assert.deepEqual(decodePacket(P.ARC_D2_ON), {
    type: 'lighting',
    packetType: 0x10,
    subtype: 1,
    protocol: 'ARC',
    level: null,
    address: 'D',
    unit: 2,
    button: '2',
    command: 'on',
    signal: 7,
  });
  assert.deepEqual(decodePacket(P.DIO_1_OFF), {
    type: 'lighting',
    packetType: 0x11,
    subtype: 0,
    protocol: 'AC',
    level: null,
    address: '39AC7A1',
    unit: 1,
    button: '1',
    command: 'off',
    signal: 15,
  });
  const group = decodePacket(P.DIO_GROUP_ON);
  assert.equal(group.button, 'group');
  assert.equal(group.command, 'group-on');
  const level = decodePacket(P.DIO_1_LEVEL);
  assert.equal(level.command, 'level');
  assert.equal(level.level, 67);
  assert.deepEqual(decodePacket(P.LWRF_OFF), {
    type: 'lighting',
    packetType: 0x14,
    subtype: 0,
    protocol: 'LIGHTWAVERF',
    level: null,
    address: 'F09AC7',
    unit: 1,
    button: '1',
    command: 'off',
    signal: 8,
  });
  assert.deepEqual(decodePacket(P.BLYSS_K4_ON), {
    type: 'lighting',
    packetType: 0x15,
    subtype: 0,
    protocol: 'BLYSS',
    level: null,
    address: 'F09A',
    group: 'K',
    unit: 4,
    button: 'K4',
    command: 'on',
    signal: 8,
  });
});

test('Security1 detectors and keyfobs', () => {
  assert.deepEqual(decodePacket(P.X10_DOOR_OPEN), {
    type: 'security',
    packetType: 0x20,
    subtype: 0,
    protocol: 'X10_DOOR',
    address: 'FF00',
    status: 2,
    tamper: false,
    battery: 100,
    signal: 8,
  });
  const motion = decodePacket(P.VISONIC_MOTION);
  assert.equal(motion.protocol, 'POWERCODE_PIR');
  assert.equal(motion.address, 'D81540');
  assert.equal(motion.status, 4);
  assert.equal(motion.tamper, true);
  assert.equal(decodePacket(P.KD101_SMOKE).address, '1234');
  assert.equal(decodePacket(P.X10_KEYFOB_ARM).address, '1256');
});

test('measuring sensors', () => {
  const decoded = (packet) => {
    const { measures, battery, signal, model, address } = decodePacket(packet);
    return { measures, battery, signal, model, address };
  };
  assert.deepEqual(decoded(P.TEMP_NEGATIVE), {
    measures: { temperature: -2 },
    battery: null,
    signal: 9,
    model: 'Oregon THR128/THR138',
    address: 'FAAF',
  });
  assert.deepEqual(decoded(P.TH_RTGR328).measures, { temperature: 14.4, humidity: 54 });
  assert.deepEqual(decoded(P.TH_THGN122), {
    measures: { temperature: 21, humidity: 58 },
    battery: 100,
    signal: 6,
    model: 'Oregon THGN122/THGR122',
    address: '9A01',
  });
  assert.deepEqual(decoded(P.THB_BTHR968).measures, {
    temperature: 20.1,
    humidity: 39,
    pressure: 999,
  });
  assert.deepEqual(decoded(P.RAIN_PCR800).measures, { rainRate: 0, rainTotal: 1977.2 });
  assert.deepEqual(decoded(P.WIND_WGR800).measures, {
    windDirection: 135,
    windSpeed: 1,
    windGust: 2,
  });
  assert.deepEqual(decoded(P.UV_UVN128).measures, { uv: 1 });
  assert.deepEqual(decoded(P.OWL_CM119), {
    measures: { power: 1014, energy: 0.061 },
    battery: 100,
    signal: 8,
    model: 'OWL CM119/CM160',
    address: '1A73',
  });
  assert.deepEqual(decoded(P.OWL_CM180).measures, { power: 370 });
  assert.deepEqual(decoded(P.OWL_CM180I).measures, {
    current1: 2.2,
    current2: 0,
    current3: 0,
    energy: 32.547,
  });
});

test('interface commands', () => {
  assert.deepEqual(bytes(resetPacket(0)), [13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(bytes(statusPacket(0)), [13, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(bytes(startReceiverPacket(5)), [13, 0, 0, 5, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    bytes(setModePacket(0, 0x53, ['LACROSSE', 'OREGON', 'AC', 'ARC', 'X10', 'NOT_A_PROTOCOL'])),
    [0x0d, 0x00, 0x00, 0x00, 0x03, 0x53, 0x1c, 0x00, 0x08, 0x27, 0x00, 0x00, 0x00, 0x00],
  );
});

test('radio commands', () => {
  // X10 C14 on.
  assert.deepEqual(
    bytes(lighting1Packet(0, { subtype: 0, house: 'C', unit: 14 }, 1)),
    [0x07, 0x10, 0x00, 0x00, 0x43, 0x0e, 0x01, 0x00],
  );
  // ANSLUT 0x3FFFFFF/1 on, then off.
  assert.deepEqual(
    bytes(lighting2Packet(0, { subtype: 2, id: 0x3ffffff, unit: 1 }, 1, 15)),
    [0x0b, 0x11, 0x02, 0x00, 0x03, 0xff, 0xff, 0xff, 0x01, 0x01, 0x0f, 0x00],
  );
  assert.deepEqual(
    bytes(lighting2Packet(0, { subtype: 2, id: 0x3ffffff, unit: 1 }, 0, 0)),
    [0x0b, 0x11, 2, 0, 3, 0xff, 0xff, 0xff, 1, 0, 0, 0],
  );
  // LightwaveRF 0xF09AC8/1 on.
  assert.deepEqual(
    bytes(lighting5Packet(0, { subtype: 0, id: 0xf09ac8, unit: 1 }, 1, 0x1f)),
    [0x0a, 0x14, 0x00, 0x00, 0xf0, 0x9a, 0xc8, 0x01, 0x01, 0x1f, 0x00],
  );
  // Blyss 0xF09A/B/1 on.
  assert.deepEqual(
    bytes(lighting6Packet(0, { subtype: 0, id: 0xf09a, group: 'B', unit: 1 }, 0, 0)),
    [0x0b, 0x15, 0x00, 0x00, 0xf0, 0x9a, 0x42, 0x01, 0x00, 0x00, 0x00, 0x00],
  );
  // RFY 0x010203/1 up, then program.
  assert.deepEqual(
    bytes(rfyPacket(0, { subtype: 0, id: 0x010203, unit: 1 }, 0x01)),
    [0x0c, 0x1a, 0x00, 0x00, 0x01, 0x02, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00],
  );
  assert.deepEqual(
    bytes(rfyPacket(0, { subtype: 0, id: 0x010203, unit: 1 }, 0x07)),
    [0x0c, 0x1a, 0x00, 0x00, 0x01, 0x02, 0x03, 0x01, 0x07, 0x00, 0x00, 0x00, 0x00],
  );
  // Every encoded packet decodes as one packet of its own length.
  const splitter = new PacketSplitter();
  const sent = rfyPacket(3, { subtype: 1, id: 0xfffff, unit: 15 }, 0x03);
  assert.deepEqual(splitter.push(sent).map(bytes), [bytes(sent)]);
});
