// -----------------------------------------------------------------------------
// The link to the RFXtrx, over TCP.
//
// Why TCP: the integration runs in a sandboxed container that is never given a
// /dev/tty* device. The RFXtrx stays plugged into a machine of the LAN (the
// Gladys host itself, a Raspberry Pi…) and ser2net exposes its serial port,
// 38400 bauds 8N1, on a TCP port: the bytes on the socket are the bytes of the
// serial line.
//
// This class owns:
//   - the socket and its reconnection (exponential backoff, for life);
//   - the handshake of the RFXtrx SDK: reset, wait, drop what came meanwhile,
//     get status, set mode (only when the user picked the protocols), start
//     receiver (current firmwares);
//   - ONE queue for every command: the RFXtrx has one radio, a command waits
//     for the answer carrying its sequence number before the next one goes;
//   - a keep-alive: a bridge keeps its port open when the RFXtrx is unplugged,
//     only a missing answer to "get status" tells.
//
// Events: `ready` (status), `down` ({ code, message }), `event` (decoded
// radio event), `unknown` (packet nobody decodes).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { TIMINGS } from './constants.js';
import { decodePacket } from './protocol/decode.js';
import {
  resetPacket,
  setModePacket,
  startReceiverPacket,
  statusPacket,
} from './protocol/encode.js';
import { PacketSplitter, hex } from './protocol/frames.js';
import { RECEIVERS_433 } from './protocol/constants.js';

const ANSWERS = [
  'status',
  'receiver-started',
  'not-understood',
  'unknown-rfy-remote',
  'tx-response',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A socket error -> a short code the texts of the app know. */
export function errorCode(err) {
  switch (err?.code) {
    case 'ECONNREFUSED':
      return 'refused';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'host';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ETIMEDOUT':
      return 'unreachable';
    default:
      return 'error';
  }
}

export class LinkError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class RfxLink extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {(opts: { host: string, port: number }) => import('node:net').Socket} [options.createSocket]
   * @param {object} [options.timings] overrides of TIMINGS
   * @param {object} [options.logger]
   */
  constructor({ createSocket, timings = {}, logger } = {}) {
    super();
    this.createSocket = createSocket ?? ((opts) => net.createConnection(opts));
    this.timings = { ...TIMINGS, ...timings };
    this.logger = logger;
    this.target = null;
    this.protocols = [];
    this.socket = null;
    this.splitter = new PacketSplitter();
    this.receiving = false;
    this.ready = false;
    this.running = false;
    /** The last status of the RFXtrx (receiver, firmware, protocols). */
    this.status = null;
    this.lastError = null;
    this.seq = 0;
    this.pending = null;
    this.queue = Promise.resolve();
    this.attempt = 0;
    this.reconnectTimer = null;
    this.keepAliveTimer = null;
    this.generation = 0;
  }

  /** `host:port`, for the messages. */
  get address() {
    return this.target ? `${this.target.host}:${this.target.port}` : null;
  }

  /**
   * Applies the configuration: a new address restarts the link, new
   * protocols are sent to an RFXtrx already connected.
   */
  configure({ host, port, protocols = [] }) {
    const next = host ? { host, port } : null;
    const moved = next?.host !== this.target?.host || next?.port !== this.target?.port;
    const changedProtocols = protocols.join() !== this.protocols.join();
    this.target = next;
    this.protocols = [...protocols];
    if (moved && this.running) {
      this.restart();
    } else if (changedProtocols && this.ready) {
      this.applyMode().catch((err) => this.logger?.warn(`Set mode failed: ${err.message}`));
    }
  }

  start() {
    this.running = true;
    if (!this.socket && !this.reconnectTimer) {
      this.open();
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardown({ code: 'stopped', message: 'stopped' });
  }

  restart() {
    this.teardown({ code: 'stopped', message: 'configuration changed' });
    this.attempt = 0;
    this.open();
  }

  nextSeq() {
    this.seq = (this.seq + 1) % 256;
    return this.seq;
  }

  open() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (!this.running || !this.target) {
      return;
    }
    const generation = ++this.generation;
    const { host, port } = this.target;
    this.logger?.info(`Connecting to the RFXtrx bridge at ${host}:${port}...`);
    let socket;
    try {
      socket = this.createSocket({ host, port });
    } catch (err) {
      this.failed(generation, { code: errorCode(err), message: err.message });
      return;
    }
    this.socket = socket;
    this.splitter.reset();
    this.receiving = false;
    let lastError = null;
    socket.setNoDelay?.(true);
    socket.setKeepAlive?.(true, 30_000);
    socket.setTimeout?.(this.timings.connectTimeout);
    socket.once('connect', () => {
      if (generation !== this.generation) {
        return;
      }
      socket.setTimeout?.(0);
      this.handshake(generation).catch((err) => {
        this.failed(generation, {
          code: err.code ?? 'no-answer',
          message: err.message,
        });
      });
    });
    socket.on('data', (chunk) => {
      if (generation === this.generation) {
        this.onData(chunk);
      }
    });
    socket.on('timeout', () => {
      if (generation === this.generation) {
        lastError = { code: 'unreachable', message: 'connection timed out' };
        socket.destroy();
      }
    });
    socket.on('error', (err) => {
      lastError = { code: errorCode(err), message: err.message };
    });
    socket.on('close', () => {
      this.failed(generation, lastError ?? { code: 'closed', message: 'connection closed' });
    });
  }

  /** A connection attempt or a live link failed: tear down, retry later. */
  failed(generation, reason) {
    if (generation !== this.generation) {
      return;
    }
    this.teardown(reason);
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (!this.running || this.reconnectTimer || !this.target) {
      return;
    }
    const delay = Math.min(
      this.timings.reconnectBase * 2 ** this.attempt,
      this.timings.reconnectMax,
    );
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /** Drops the socket and everything waiting on it. */
  teardown(reason) {
    this.generation += 1;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.receiving = false;
    if (socket) {
      socket.removeAllListeners('data');
      socket.removeAllListeners('close');
      socket.on('error', () => {});
      socket.destroy();
    }
    if (this.pending) {
      this.pending.reject(new LinkError('closed', `link down: ${reason.message}`));
      this.pending = null;
    }
    this.queue = Promise.resolve();
    const wasReady = this.ready;
    this.ready = false;
    if (reason.code === 'stopped') {
      if (wasReady) {
        this.logger?.info('RFXtrx link closed');
      }
      return;
    }
    this.lastError = reason;
    if (wasReady) {
      this.logger?.warn(`RFXtrx link down: ${reason.message}`);
    }
    this.emit('down', reason);
  }

  async handshake(generation) {
    // Reset, then wait: the RFXtrx may still be sending, and its answers to
    // the next commands must start on a clean stream.
    this.write(resetPacket(this.nextSeq()));
    await sleep(this.timings.resetDelay);
    if (generation !== this.generation) {
      return;
    }
    this.splitter.reset();
    this.receiving = true;
    this.status = await this.command(statusPacket);
    await this.applyMode();
    if (this.status.needsStartReceiver) {
      await this.command(startReceiverPacket, ['receiver-started', 'not-understood']);
    }
    if (generation !== this.generation) {
      return;
    }
    this.ready = true;
    this.attempt = 0;
    this.lastError = null;
    const s = this.status;
    this.logger?.info(
      `RFXtrx ready: ${s.receiverName}, firmware ${s.firmwareVersion}${s.firmwareType ? ` ${s.firmwareType}` : ''}, protocols ${s.protocols.join(', ') || 'none'}`,
    );
    this.keepAliveTimer = setInterval(() => this.keepAlive(), this.timings.keepAlive);
    this.emit('ready', this.status);
  }

  /** Sends "set mode" when the user picked protocols the RFXtrx does not have. */
  async applyMode() {
    const status = this.status;
    if (!status || this.protocols.length === 0) {
      return;
    }
    const wanted = [...this.protocols].sort().join();
    if ([...status.protocols].sort().join() === wanted) {
      return;
    }
    if (!RECEIVERS_433.includes(status.receiverType)) {
      this.logger?.warn(
        `Protocols left as they are: ${status.receiverName} is not a 433 MHz RFXtrx`,
      );
      return;
    }
    this.status = await this.command((seq) =>
      setModePacket(seq, status.receiverType, this.protocols),
    );
  }

  async keepAlive() {
    try {
      await this.refreshStatus();
    } catch (err) {
      this.logger?.warn(`No answer from the RFXtrx (${err.message}): reconnecting`);
      this.failed(this.generation, { code: 'no-answer', message: 'no answer to get status' });
    }
  }

  /** Asks the RFXtrx its status again (connection test, keep-alive). */
  async refreshStatus() {
    if (!this.ready) {
      throw new LinkError('not-ready', 'the RFXtrx is not connected');
    }
    this.status = await this.command(statusPacket);
    return this.status;
  }

  /**
   * Sends a radio packet and waits for the RFXtrx to acknowledge it.
   * @param {(seq: number) => Buffer} build
   */
  async transmit(build) {
    if (!this.ready) {
      throw new LinkError(
        'not-ready',
        `the RFXtrx is not connected (${this.lastError?.message ?? 'connecting'})`,
      );
    }
    const answer = await this.request(
      build,
      ['tx-response', 'unknown-rfy-remote', 'not-understood'],
      this.timings.transmitTimeout,
    );
    if (answer.type === 'unknown-rfy-remote') {
      throw new LinkError('rfy-unknown', 'the RFXtrx does not know this RFY remote: pair it first');
    }
    if (answer.type === 'not-understood') {
      throw new LinkError('refused', 'the RFXtrx did not understand the command');
    }
    if (!answer.ok) {
      throw new LinkError('refused', `the RFXtrx refused to transmit: ${answer.message}`);
    }
    return answer;
  }

  /** An interface command; resolves the status (or the start answer). */
  async command(build, accept = ['status']) {
    const answer = await this.request(
      build,
      [...accept, 'not-understood'],
      this.timings.commandTimeout,
    );
    if (answer.type === 'not-understood' && !accept.includes('not-understood')) {
      throw new LinkError('no-answer', 'the RFXtrx did not understand the command');
    }
    return answer;
  }

  /** Queues a packet; resolves the answer carrying its sequence number. */
  request(build, types, timeout) {
    const generation = this.generation;
    const run = this.queue.then(() => {
      if (!this.socket || generation !== this.generation) {
        throw new LinkError('closed', 'the RFXtrx is not connected');
      }
      return new Promise((resolve, reject) => {
        const seq = this.nextSeq();
        const timer = setTimeout(() => {
          if (this.pending?.seq === seq) {
            this.pending = null;
          }
          reject(new LinkError('no-answer', 'no answer from the RFXtrx'));
        }, timeout);
        const settle = (fn) => (value) => {
          clearTimeout(timer);
          fn(value);
        };
        this.pending = { seq, types, resolve: settle(resolve), reject: settle(reject) };
        this.write(build(seq));
      });
    });
    // The chain itself never rejects: one failed command must not block the next ones.
    this.queue = run.catch(() => {});
    return run;
  }

  write(bytes) {
    this.logger?.debug(`-> ${hex(bytes)}`);
    this.socket.write(bytes);
  }

  onData(chunk) {
    if (!this.receiving) {
      return;
    }
    for (const packet of this.splitter.push(chunk)) {
      this.logger?.debug(`<- ${hex(packet)}`);
      const event = decodePacket(packet);
      if (!event) {
        this.emit('unknown', packet);
      } else if (ANSWERS.includes(event.type)) {
        this.onAnswer(event);
      } else {
        this.emit('event', event, packet);
      }
    }
  }

  onAnswer(event) {
    const pending = this.pending;
    if (pending && pending.seq === event.seq && pending.types.includes(event.type)) {
      this.pending = null;
      pending.resolve(event);
      return;
    }
    this.logger?.debug(`Unexpected ${event.type} (sequence ${event.seq})`);
  }
}
