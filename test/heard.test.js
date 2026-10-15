// -----------------------------------------------------------------------------
// The registry of the emitters heard: shape changes, bound, persistence.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify } from '../src/devices.js';
import { HeardRegistry } from '../src/heard.js';
import { decodePacket } from '../src/protocol/decode.js';
import * as P from './fixtures/packets.js';

const read = (packet) => classify(decodePacket(packet));

test('a new measure or button changes the shape of the device, a repeat does not', () => {
  const registry = new HeardRegistry();
  assert.equal(registry.record(read(P.DIO_1_ON)).isNew, true);
  assert.equal(registry.record(read(P.DIO_1_OFF)).shapeChanged, false);
  const group = registry.record(read(P.DIO_GROUP_ON));
  assert.equal(group.shapeChanged, true);
  assert.deepEqual(group.entry.buttons, ['1', 'group']);
  assert.equal(group.entry.frames, 3);
  const { entry } = registry.record(read(P.TH_THGN122));
  assert.deepEqual(entry.values, { temperature: 21, humidity: 58, battery: 100, signal: 2 });
  assert.equal(registry.size, 2);
});

test('the oldest emitter the user did not create goes first', () => {
  let now = 0;
  const registry = new HeardRegistry({ max: 2, now: () => now });
  for (const packet of [P.TH_THGN122, P.UV_UVN128, P.OWL_CM119]) {
    now += 1000;
    registry.record(read(packet), (e) => e.platformId === '52-01-9A01');
  }
  assert.deepEqual(
    registry.values().map((e) => e.platformId),
    ['52-01-9A01', '5A-01-1A73'],
  );
  registry.forget('sensor', '52-01-9A01');
  assert.equal(registry.size, 1);
});

test('the registry is saved to /data and read back', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rfxcom-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'heard.json');
  const registry = new HeardRegistry({ file, now: () => 42 });
  await registry.load(); // no file yet
  registry.record(read(P.TH_THGN122));
  registry.record(read(P.DIO_1_ON));
  await registry.save();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.entries.length, 2);
  assert.equal(saved.entries[0].values, undefined, 'values stay in memory');

  const again = new HeardRegistry({ file });
  await again.load();
  assert.deepEqual(
    again
      .values()
      .map((e) => [e.family, e.platformId, e.measures, e.buttons, e.battery, e.lastSeen]),
    [
      ['sensor', '52-01-9A01', ['temperature', 'humidity'], [], true, 42],
      ['remote', '11-00-39AC7A1', [], ['1'], false, 42],
    ],
  );
  // A clean registry is not written again, unless forced (shutdown).
  await writeFile(file, 'untouched');
  await again.save();
  assert.equal(await readFile(file, 'utf8'), 'untouched');
  await again.save({ force: true });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).entries.length, 2);
  // An unreadable or foreign file is ignored.
  await writeFile(file, JSON.stringify({ version: 99, entries: [] }));
  const other = new HeardRegistry({ file });
  await other.load();
  assert.equal(other.size, 0);
});
