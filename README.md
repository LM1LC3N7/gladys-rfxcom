# gladys-rfxcom

[Gladys Assistant](https://gladysassistant.com) external integration for the
**RFXCOM RFXtrx433 / RFXtrx433E / RFXtrx433XL** 433 MHz transceivers. The
RFXtrx stays on a machine of the LAN and is reached over TCP through ser2net
(38400 bauds), like the RFPlayer integration: the Gladys sandbox gives no USB
or serial access. Sensors, detectors and remotes heard on the air go to the
Discovery tab; the receivers the RFXtrx drives (Chacon DiO, X10, Blyss,
LightwaveRF, Somfy RTS…) are declared or paired from the configuration.
Unofficial, not affiliated with RFXCOM.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/159).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (RfxcomApp) ⇄ src/link.js ⇄ TCP ⇄ ser2net ⇄ RFXtrx
                                   ├─ src/protocol/      packets: split, decode, encode (pure)
                                   ├─ src/devices.js     events -> Gladys devices and states (pure)
                                   ├─ src/actuators.js   declared receivers, addresses, orders (pure)
                                   ├─ src/heard.js       emitters heard, kept in /data
                                   └─ src/publisher.js   states within 300/min, button presses
```

- **Link**: one TCP connection to ser2net, reconnected for life (backoff up
  to 60 s). Handshake of the RFXtrx SDK: reset, wait 500 ms and drop what
  came, get status, set mode (only when the user ticked protocols; never
  saved in the flash of the RFXtrx), start receiver (current firmwares). Every
  command waits for the answer carrying its sequence number; a transmission
  waits for its ACK/NAK. "Get status" every 5 minutes is the keep-alive.
- **Heard**: Oregon/OWL sensors (packet types 0x50-0x5B), Security1 detectors
  and keyfobs (0x20), Lighting1/2/5/6 remotes (0x10, 0x11, 0x14, 0x15). Each
  emitter is a device of the Discovery tab, with one feature per measure or
  button heard; values are sent only for the devices created.
- **Driven**: Lighting1/2/5/6 switches, lights and dimmers, RFY (Somfy RTS)
  shutters. A remote heard whose address matches a declared receiver moves
  its state.
- **Scene trigger** `remote_pressed`, deduplicated (a remote repeats its
  frame), within 250 events per minute.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/packets.js` holds packets recorded from real RFXtrx devices
(from the node-rfxcom test suite) and a few shaped on the RFXtrx SDK layouts.
`test/helpers/fakeRfxtrx.js` is a fake ser2net + RFXtrx on the loopback
interface; the end-to-end tests run the real SDK wiring against it and the
SDK's fake Gladys.

The packet layouts are ported from [node-rfxcom](https://github.com/rfxcom/node-rfxcom)
(MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)); the library
itself is not a dependency (it needs `serialport` and its native bindings).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0. Portions ported from node-rfxcom, MIT.
