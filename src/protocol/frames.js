// -----------------------------------------------------------------------------
// The byte stream of the RFXtrx cut into packets.
//
// The serial line (here, the TCP socket of the bridge) carries packets back to
// back: the first byte of each one is the number of bytes that follow. A chunk
// may hold several packets or a piece of one. A length byte outside the range
// of the protocol means the stream is out of step (the bridge was opened in the
// middle of a packet, noise on a cheap serial adapter): everything buffered is
// dropped and the next chunk starts afresh, like node-rfxcom does.
// -----------------------------------------------------------------------------

/** Shortest and longest packet lengths (the length byte) of the protocol. */
export const LENGTH = { min: 4, max: 0x40 };

export class PacketSplitter {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.dropped = 0;
  }

  /** Forget what was buffered (after a reset, the answers must start clean). */
  reset() {
    this.buffer = Buffer.alloc(0);
  }

  /** @returns {Buffer[]} the complete packets, length byte included. */
  push(chunk) {
    this.buffer = this.buffer.length > 0 ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    const packets = [];
    while (this.buffer.length > 0) {
      const length = this.buffer[0];
      if (length < LENGTH.min || length > LENGTH.max) {
        this.dropped += this.buffer.length;
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (this.buffer.length < length + 1) {
        break;
      }
      packets.push(this.buffer.subarray(0, length + 1));
      this.buffer = this.buffer.subarray(length + 1);
    }
    return packets;
  }
}

/** "0B 11 00 ..." for the logs. */
export function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
