// -----------------------------------------------------------------------------
// The states sent to Gladys, within its 300 states per minute.
//
// The publisher keeps the LAST value of each feature, sends the pending ones
// every second within a per-minute budget and skips the unchanged ones
// (publishChangedStates, with a heartbeat so a stable value stays recently
// dated). A burst of radio frames (a remote held down, ten probes speaking at
// once) never exceeds the budget: what does not fit waits for the next second.
//
// Button presses are events, not values: pressing "on" twice must reach Gladys
// twice, so they are queued one by one and sent with publishStates.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from './constants.js';

export class StatePublisher {
  constructor({
    gladys,
    logger,
    now = Date.now,
    timers = globalThis,
    budget = LIMITS.statesPerMinute,
    flushInterval = TIMINGS.flushInterval,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.budget = budget;
    this.flushInterval = flushInterval;
    /** featureId -> state */
    this.pending = new Map();
    /** [{ featureId, state }] button presses, in order */
    this.events = [];
    /** send times of the last minute */
    this.window = [];
    this.timer = undefined;
    this.flushing = undefined;
  }

  start() {
    this.stop();
    this.timer = this.timers.setInterval(() => {
      this.flush().catch((err) => this.logger?.warn(`Sending the states failed: ${err.message}`));
    }, this.flushInterval);
  }

  stop() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  push(featureId, state) {
    // Re-inserted: the oldest pending values go first.
    this.pending.delete(featureId);
    this.pending.set(featureId, state);
  }

  /** A button press: sent even when equal to the previous one. */
  pushEvent(featureId, state) {
    this.events.push({ featureId, state });
  }

  /** Drops the pending values of a device (deleted by the user). */
  forget(deviceId) {
    const mine = (key) => key.startsWith(`${deviceId}:`);
    for (const key of this.pending.keys()) {
      if (mine(key)) {
        this.pending.delete(key);
      }
    }
    this.events = this.events.filter((e) => !mine(e.featureId));
  }

  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  async doFlush() {
    const now = this.now();
    this.window = this.window.filter((t) => now - t < 60_000);
    let sent = 0;
    if (this.events.length > 0 && this.budget - this.window.length > 0) {
      const events = this.events.splice(0, Math.min(100, this.budget - this.window.length));
      try {
        await this.gladys.publishStates(
          events.map((e) => ({ device_feature_external_id: e.featureId, state: e.state })),
        );
      } catch (err) {
        this.events.unshift(...events);
        throw err;
      }
      this.window.push(...events.map(() => now));
      sent += events.length;
    }
    return sent + (await this.flushValues(now));
  }

  async flushValues(now) {
    const room = this.budget - this.window.length;
    if (room <= 0 || this.pending.size === 0) {
      return 0;
    }
    const batch = [];
    for (const [featureId, state] of this.pending) {
      if (batch.length >= room) {
        break;
      }
      batch.push({ device_feature_external_id: featureId, state });
    }
    for (const entry of batch) {
      this.pending.delete(entry.device_feature_external_id);
    }
    try {
      const result = await this.gladys.publishChangedStates(batch, {
        heartbeat: TIMINGS.stateHeartbeat,
      });
      const count = result?.count ?? batch.length;
      for (let i = 0; i < count; i += 1) {
        this.window.push(now);
      }
      return count;
    } catch (err) {
      // Keep the values for the next round, unless a newer one arrived meanwhile.
      for (const { device_feature_external_id: id, state } of batch) {
        if (!this.pending.has(id)) {
          this.pending.set(id, state);
        }
      }
      throw err;
    }
  }
}
