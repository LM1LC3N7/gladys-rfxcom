// -----------------------------------------------------------------------------
// Packets sent to the RFXtrx (pure). Each builder takes the sequence number
// the link allocates, and returns the whole packet, length byte included.
//
// The layouts are ported from node-rfxcom (MIT, Copyright (c) 2012-2017 Kevin
// McDermott, see THIRD_PARTY_NOTICES.md); its tests are the reference of the
// encoder tests (test/encode.test.js).
// -----------------------------------------------------------------------------

import { CONTROL, PACKET, PROTOCOLS } from './constants.js';

/** Interface control packet: 0x0D 0x00 0x00 seq cmnd msg1..msg9. */
function control(seq, command, msg = []) {
  const body = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  msg.forEach((value, i) => {
    body[i] = value;
  });
  return Buffer.from([0x0d, PACKET.INTERFACE_CONTROL, 0x00, seq, command, ...body]);
}

export const resetPacket = (seq) => control(seq, CONTROL.RESET);
export const statusPacket = (seq) => control(seq, CONTROL.GET_STATUS);
export const startReceiverPacket = (seq) => control(seq, CONTROL.START_RECEIVER);

/** msg3..msg6 of the receiving protocols named (unknown names are ignored). */
export function protocolBytes(names) {
  const bytes = [0, 0, 0, 0];
  for (const name of names) {
    const protocol = PROTOCOLS[name];
    if (protocol) {
      bytes[protocol.msg - 3] |= protocol.bit;
    }
  }
  return bytes;
}

/**
 * Set mode: keeps the receiver type (frequency) and turns on exactly the
 * protocols named. msg2 is the transmit power the 433 MHz firmwares expect
 * (0x1C, +10 dBm), as node-rfxcom sends it. Not saved in the flash of the
 * RFXtrx: the integration sends it again at every connection.
 */
export function setModePacket(seq, receiverType, names) {
  return control(seq, CONTROL.SET_MODE, [receiverType, 0x1c, ...protocolBytes(names)]);
}

const packet = (type, subtype, seq, body) =>
  Buffer.from([body.length + 3, type, subtype, seq, ...body]);

/** Lighting1 (X10, ARC, Chacon EMW200…): house code A-P, unit, command. */
export function lighting1Packet(seq, { subtype, house, unit }, command) {
  return packet(PACKET.LIGHTING1, subtype, seq, [house.charCodeAt(0), unit, command, 0]);
}

/** Lighting2 (AC: Chacon DiO, KlikAanKlikUit, Nexa…; HomeEasy EU): 26-bit id. */
export function lighting2Packet(seq, { subtype, id, unit }, command, level) {
  const idBytes = [(id >>> 24) & 0x03, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff];
  return packet(PACKET.LIGHTING2, subtype, seq, [...idBytes, unit, command, level, 0]);
}

/** Lighting5 (LightwaveRF, Conrad RSL, EMW100, IT…): 24-bit id. */
export function lighting5Packet(seq, { subtype, id, unit }, command, level) {
  const idBytes = [(id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff];
  return packet(PACKET.LIGHTING5, subtype, seq, [...idBytes, unit, command, level, 0]);
}

/**
 * Lighting6 (Blyss): 16-bit id, group A-P, unit. `rolling` is the command
 * sequence number of the Blyss protocol (0-4), not the one of the RFXtrx.
 */
export function lighting6Packet(seq, { subtype, id, group, unit }, command, rolling) {
  return packet(PACKET.LIGHTING6, subtype, seq, [
    (id >>> 8) & 0xff,
    id & 0xff,
    group.charCodeAt(0),
    unit,
    command,
    rolling,
    0,
    0,
  ]);
}

/**
 * RFY (Somfy RTS): the RFXtrx433E/XL plays a virtual remote of its own, whose
 * 20-bit id and unit are chosen freely; its rolling code is kept by the RFXtrx.
 */
export function rfyPacket(seq, { subtype, id, unit }, command) {
  return packet(PACKET.RFY, subtype, seq, [
    (id >>> 16) & 0xff,
    (id >>> 8) & 0xff,
    id & 0xff,
    unit,
    command,
    0,
    0,
    0,
    0,
  ]);
}
