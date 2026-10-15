// -----------------------------------------------------------------------------
// A fake RFXtrx behind a fake ser2net: a TCP server on the loopback interface
// that answers the commands of the integration like an RFXtrx433E does (get
// status, set mode, start receiver, transmit), and sends radio packets on
// demand. Nothing leaves the test process.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { PacketSplitter } from '../../src/protocol/frames.js';
import { COPYRIGHT, STATUS_EXT, STATUS_OLD, TX_ACK, TX_NAK } from '../fixtures/packets.js';

export class FakeRfxtrx {
  /**
   * @param {object} [options]
   * @param {boolean} [options.silent] a bridge whose RFXtrx is unplugged: never answers
   * @param {boolean} [options.oldFirmware] 14-byte status, no "start receiver"
   */
  constructor({ silent = false, oldFirmware = false } = {}) {
    this.silent = silent;
    this.oldFirmware = oldFirmware;
    this.status = Buffer.from(oldFirmware ? STATUS_OLD : STATUS_EXT);
    /** Every packet received from the integration. */
    this.received = [];
    /** Transmissions refused (NAK) while true. */
    this.refuse = false;
    this.sockets = new Set();
    this.connections = 0;
    this.server = net.createServer((socket) => this.onConnection(socket));
  }

  async listen() {
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = this.server.address().port;
    return this;
  }

  onConnection(socket) {
    this.connections += 1;
    this.sockets.add(socket);
    const splitter = new PacketSplitter();
    socket.on('data', (chunk) => {
      for (const packet of splitter.push(chunk)) {
        this.received.push([...packet]);
        this.answer(socket, packet);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => this.sockets.delete(socket));
  }

  answer(socket, packet) {
    if (this.silent) {
      return;
    }
    const [, type, , seq, command] = packet;
    if (type === 0x00) {
      if (command === 0x02) {
        socket.write(this.statusAnswer(seq, 0x02));
      } else if (command === 0x03) {
        // Set mode: msg3..msg6 become the protocols of the status.
        this.status[7] = packet[7];
        this.status[8] = packet[8];
        this.status[9] = packet[9];
        this.status[10] = packet[10];
        socket.write(this.statusAnswer(seq, 0x03));
      } else if (command === 0x07) {
        const copyright = Buffer.from(COPYRIGHT);
        copyright[3] = seq;
        socket.write(copyright);
      }
      return;
    }
    socket.write(this.refuse ? TX_NAK(seq) : TX_ACK(seq));
  }

  statusAnswer(seq, command) {
    const status = Buffer.from(this.status);
    status[3] = seq;
    status[4] = command;
    return status;
  }

  /** The commands received, without the control packets of the handshake. */
  get transmitted() {
    return this.received
      .filter((p) => p[1] !== 0x00)
      .map((p) => [...p.slice(0, 3), 0, ...p.slice(4)]);
  }

  /** The interface commands received (0 reset, 2 status, 3 set mode, 7 start). */
  get commands() {
    return this.received.filter((p) => p[1] === 0x00).map((p) => p[4]);
  }

  /** A radio packet heard by the RFXtrx. */
  send(packet) {
    for (const socket of this.sockets) {
      socket.write(packet);
    }
  }

  /** The bridge drops the TCP connection. */
  drop() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }

  async close() {
    this.drop();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

/** Polls a condition (real timers: the link talks to a real socket). */
export async function waitFor(predicate, { timeout = 3000, message = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) {
      return value;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
