// -----------------------------------------------------------------------------
// The emitters heard on the air.
//
// Radio transmitters are not enumerated: one exists for the integration the
// moment one of its frames is heard. The registry is what the Discovery tab
// lists. It is bounded (the neighbours' probes are heard too: the oldest one
// the user did not create goes first) and saved to /data, the only writable
// path of the container, so a restart does not empty the Discovery tab until
// every probe has spoken again. A failed save is logged, never fatal.
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { LIMITS } from './constants.js';

const FILE_VERSION = 1;
const KEPT = [
  'family',
  'platformId',
  'protocol',
  'packetType',
  'subtype',
  'address',
  'model',
  'detection',
  'measures',
  'buttons',
  'battery',
  'firstSeen',
  'lastSeen',
  'frames',
];

export const keyOf = (family, platformId) => `${family}:${platformId}`;

export class HeardRegistry {
  /**
   * @param {object} [options]
   * @param {string|null} [options.file] where to save; null keeps it in memory
   * @param {number} [options.max]
   * @param {() => number} [options.now]
   */
  constructor({ file = null, max = LIMITS.heard, now = Date.now } = {}) {
    this.file = file;
    this.max = max;
    this.now = now;
    /** key -> entry */
    this.entries = new Map();
    this.dirty = false;
  }

  get size() {
    return this.entries.size;
  }

  get(family, platformId) {
    return this.entries.get(keyOf(family, platformId));
  }

  values() {
    return [...this.entries.values()];
  }

  /**
   * Records a reading (src/devices.js `classify`) and the values it carries
   * (kept in memory only, sent when the user creates the device).
   * @param {(entry: object) => boolean} [isKept] the entries the user created, never evicted
   * @returns {{ entry: object, isNew: boolean, shapeChanged: boolean }}
   *   shapeChanged: the device gained a feature (a measure, a button, a battery
   *   level), so the Discovery tab must be published again.
   */
  record(reading, isKept = () => false) {
    const key = keyOf(reading.family, reading.platformId);
    let entry = this.entries.get(key);
    const isNew = !entry;
    const now = this.now();
    if (isNew) {
      entry = {
        family: reading.family,
        platformId: reading.platformId,
        protocol: reading.protocol,
        packetType: reading.packetType,
        subtype: reading.subtype,
        address: reading.address,
        model: reading.model ?? null,
        detection: reading.detection ?? null,
        measures: [],
        buttons: [],
        battery: false,
        firstSeen: now,
        frames: 0,
        values: {},
      };
      this.entries.set(key, entry);
    }
    entry.lastSeen = now;
    entry.frames += 1;
    Object.assign(entry.values, reading.values);
    if (isNew) {
      this.evict(isKept, key);
    }
    let shapeChanged = isNew;
    for (const measure of reading.measures) {
      if (!entry.measures.includes(measure)) {
        entry.measures.push(measure);
        shapeChanged = true;
      }
    }
    if (reading.button && !entry.buttons.includes(reading.button.key)) {
      entry.buttons.push(reading.button.key);
      shapeChanged = true;
    }
    if (reading.battery !== null && !entry.battery) {
      entry.battery = true;
      shapeChanged = true;
    }
    this.dirty = this.dirty || shapeChanged;
    return { entry, isNew, shapeChanged };
  }

  /** Drops the least recently heard entries beyond the bound. */
  evict(isKept, newcomer) {
    while (this.entries.size > this.max) {
      let oldest = null;
      for (const [key, entry] of this.entries) {
        if (
          key !== newcomer &&
          !isKept(entry) &&
          (!oldest || entry.lastSeen < oldest[1].lastSeen)
        ) {
          oldest = [key, entry];
        }
      }
      if (!oldest) {
        return;
      }
      this.entries.delete(oldest[0]);
    }
  }

  /** Forgets an emitter (its device was deleted and it is not heard again). */
  forget(family, platformId) {
    this.dirty = this.entries.delete(keyOf(family, platformId)) || this.dirty;
  }

  async load() {
    if (!this.file) {
      return;
    }
    let data;
    try {
      data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      return;
    }
    if (data?.version !== FILE_VERSION || !Array.isArray(data.entries)) {
      return;
    }
    for (const saved of data.entries.slice(-this.max)) {
      if (typeof saved?.family !== 'string' || typeof saved.platformId !== 'string') {
        continue;
      }
      const key = keyOf(saved.family, saved.platformId);
      if (!this.entries.has(key)) {
        this.entries.set(key, {
          ...Object.fromEntries(KEPT.map((k) => [k, saved[k]])),
          measures: Array.isArray(saved.measures) ? saved.measures.map(String) : [],
          buttons: Array.isArray(saved.buttons) ? saved.buttons.map(String) : [],
          battery: saved.battery === true,
          frames: Number(saved.frames) || 0,
          lastSeen: Number(saved.lastSeen) || 0,
          values: {},
        });
      }
    }
  }

  /**
   * Writes the registry atomically (temporary file, then rename). Only after a
   * change of shape, unless forced (at shutdown, to keep the last times heard).
   */
  async save({ force = false } = {}) {
    if (!this.file || (!this.dirty && !force)) {
      return;
    }
    this.dirty = false;
    const entries = this.values().map((e) => Object.fromEntries(KEPT.map((k) => [k, e[k]])));
    const temporary = `${this.file}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: FILE_VERSION, entries }));
      await rename(temporary, this.file);
    } catch (err) {
      this.dirty = true;
      throw err;
    }
  }
}
