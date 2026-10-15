# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
connects over TCP to ser2net, which exposes an RFXCOM RFXtrx433/433E/433XL
(38400 bauds), speaks the RFXtrx binary protocol, offers the emitters heard
in the Discovery tab, drives the receivers the user declared, and fires the
`remote_pressed` scene trigger. Not affiliated with RFXCOM.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js              SDK bootstrap only
src/handlers.js       every SDK handler -> the app (shared with the tests)
src/app.js            RfxcomApp: config, events -> states/triggers, commands,
                      actions, transport badges
src/link.js           RfxLink: the only network access (TCP to ser2net),
                      handshake, command queue, keep-alive, reconnection
src/protocol/         constants.js (types, subtypes, protocol bits),
                      frames.js (stream -> packets), decode.js, encode.js (pure)
src/devices.js        events -> readings -> Gladys devices (pure)
src/actuators.js      the Actuators field, addresses, orders -> packets (pure)
src/heard.js          the emitters heard, bounded, saved to /data
src/publisher.js      states within the Gladys rate limit
src/config.js         config_schema normalized
src/constants.js      manifest keys, Gladys value enums, limits, timings
src/i18n.js           runtime texts (en/fr)
test/fixtures/        packets recorded from real devices (node-rfxcom tests)
test/helpers/         a fake ser2net + RFXtrx on 127.0.0.1; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: heard devices =
  `<family>:<packet type>-<subtype>-<address>` (family `sensor`, `detector`,
  `remote`), receivers = `actuator:<PROTOCOL>-<address>`; feature keys
  (`temperature`, `button-1`, `binary`, `state`…). Never change how they are
  built.
- Manifest keys (`test_connection`, `pair_actuator` and its fields,
  `remote_pressed` and its fields/variables, config keys) are frozen: users
  store them.
- The syntax of the `actuators` field is a user contract: extend it, never
  break it.
- Value enums come from Gladys core `server/utils/constants.js` (copied in
  `src/constants.js`): cover -1/0/1, opening sensor 0 = open / 1 = closed,
  BUTTON_STATUS.
- Never send "save settings" (flash) to the RFXtrx: set mode at every
  connection instead.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only, no USB, no serial).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Code ported from node-rfxcom keeps its MIT notice
  ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
