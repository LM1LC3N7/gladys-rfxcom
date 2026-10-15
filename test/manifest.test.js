// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, PROTOCOLS } from '../src/actuators.js';
import { DEFAULTS, MIN_SIGNAL, RECEIVER_PROTOCOLS } from '../src/config.js';
import { ACTIONS, DEFAULT_PORT, SCENE_TRIGGERS } from '../src/constants.js';
import { PROTOCOLS as RECEIVING } from '../src/protocol/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const values = (field) => field.options.map((o) => o.value);

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/, 'scene triggers need Gladys 5.1');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-rfxcom:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || !['', null].includes(value)) {
      if (!Array.isArray(value)) {
        assert.deepEqual(fields[key].default, value, key);
      }
    }
  }
  assert.equal(fields.port.default, DEFAULT_PORT);
  assert.equal(fields.host.required, true);
  assert.equal(fields.min_signal.min, MIN_SIGNAL.min);
  assert.equal(fields.min_signal.max, MIN_SIGNAL.max);
  assert.deepEqual(values(fields.receiver_protocols), RECEIVER_PROTOCOLS);
  for (const protocol of RECEIVER_PROTOCOLS) {
    assert.ok(RECEIVING[protocol], `${protocol} is not a receiving protocol of the RFXtrx`);
  }
  for (const section of [fields.intro, manifest.actions[1].fields[0]]) {
    assert.equal(section.type, 'section');
    for (const lang of ['en', 'fr']) {
      assert.ok(
        section.description[lang].length <= 1000,
        `${section.key}.${lang} over 1000 characters`,
      );
    }
  }
  assert.ok(fields.intro.links.length <= 5);
  assert.ok(fields.intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(
      typeof field.placeholder,
      'object',
      `${field.key}: placeholder must be multi-language`,
    );
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the pairing form offers what the code drives', () => {
  const pair = manifest.actions.find((a) => a.key === ACTIONS.PAIR);
  const fields = Object.fromEntries(pair.fields.map((f) => [f.key, f]));
  assert.deepEqual(values(fields.kind).sort(), [...KINDS].sort());
  assert.deepEqual(values(fields.protocol).sort(), Object.keys(PROTOCOLS).sort());
  assert.ok(values(fields.kind).includes(fields.kind.default));
  assert.ok(values(fields.protocol).includes(fields.protocol.default));
  // The fields the handler reads.
  for (const key of ['name', 'kind', 'protocol', 'address', 'send_pairing']) {
    assert.ok(fields[key], key);
    assert.match(app, new RegExp(`fields\\.${key}`), `fields.${key} is never read`);
  }
});

test('the trigger fields and variables are what the events carry', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGERS.REMOTE_PRESSED);
  const declared = new Set([...trigger.fields, ...trigger.variables].map((f) => f.key));
  assert.deepEqual([...declared], ['device', 'button', 'command', 'level', 'protocol', 'address']);
  // The data object of publishSceneEvent in src/app.js.
  const sent = /publishSceneEvent\(SCENE_TRIGGERS\.REMOTE_PRESSED, \{([\s\S]*?)\}\)/.exec(app)[1];
  for (const key of declared) {
    assert.match(sent, new RegExp(`\\b${key}\\b`), `${key} is never sent`);
  }
  const device = trigger.fields.find((f) => f.key === 'device');
  assert.equal(device.source, 'devices');
  assert.equal(device.options, undefined);
});
