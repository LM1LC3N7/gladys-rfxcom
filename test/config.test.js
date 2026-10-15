import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseHost } from '../src/config.js';

test('the defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    host: null,
    hostError: 'empty',
    port: 4001,
    protocols: [],
    minSignal: 0,
    actuatorsText: '',
    actuators: [],
    actuatorErrors: [],
  });
});

test('the bridge address', () => {
  assert.deepEqual(parseHost(' 192.168.1.10 '), { host: '192.168.1.10' });
  assert.deepEqual(parseHost('tcp://rfx.lan:4002/'), { host: 'rfx.lan', port: 4002 });
  assert.deepEqual(parseHost('localhost'), { error: 'localhost' });
  assert.deepEqual(parseHost('127.0.0.1:4001'), { error: 'localhost' });
  assert.deepEqual(parseHost('bad host!'), { error: 'invalid' });
  assert.equal(normalizeConfig({ host: '10.0.0.2:5000', port: 4001 }).port, 5000);
});

test('protocols, signal and actuators', () => {
  const config = normalizeConfig({
    host: '10.0.0.2',
    port: '70000',
    receiver_protocols: ['oregon', 'AC', 'AC', 'NOPE'],
    min_signal: 40,
    actuators: 'Volet = shutter RFY 10203/1; oops',
  });
  assert.equal(config.port, 65535);
  assert.deepEqual(config.protocols, ['OREGON', 'AC']);
  assert.equal(config.minSignal, 15);
  assert.equal(config.actuators.length, 1);
  assert.deepEqual(config.actuatorErrors, [{ entry: 'oops', error: 'syntax' }]);
  assert.deepEqual(normalizeConfig({ host: 'a', receiver_protocols: 'X10, ARC' }).protocols, [
    'X10',
    'ARC',
  ]);
});
