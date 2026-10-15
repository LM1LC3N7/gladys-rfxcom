# TODO — RFXCOM RFXtrx v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).

## Status

- [x] **Milestone 1 — core** (2026-10-15): TCP link to ser2net with the
      RFXtrx handshake (reset, status, set mode, start receiver), command
      queue with ACK/NAK, keep-alive, reconnection; decoding of Oregon
      temperature/humidity/baro/rain/wind/UV, OWL CM113/CM119/CM160/CM180/
      CM180i, Security1 (door, motion, smoke, keyfobs), Lighting1/2/5/6
      remotes; Discovery with a registry saved in /data; button features and
      the `remote_pressed` trigger; actuators (switch, light, dimmer, RFY
      shutter) declared or paired; states follow the user's own remotes;
      transport badges (silent sensors unreachable); manifest, docs en/fr.
      57 unit and end-to-end tests (fake ser2net + RFXtrx).
- [ ] **Milestone 2 — real hardware**: run against an RFXtrx433XL and an
      RFXtrx433E through ser2net; record real frames as fixtures (THGR122,
      WGR800, PCR800, CM180, DiO remote and plug, Visonic, KD101); check the
      battery nibble of the Security1 sensors (KD101, Visonic), the start
      receiver answer of the XL firmware, RFY pairing and "my".
- [ ] **Milestone 3 — more devices**: "Replace a probe" action (Oregon address
      changed after a battery change), Blinds1 motors (DC106, Dooya, Brel…),
      Lighting4 (PT2262 generic plugs and sensors), chimes (Byron), Cartelectronic
      TIC/Linky, RFY venetian and sun sensor commands, RFXmeter.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## Forum

No dedicated topic for this integration. Once the 10 integrations claimed on
2026-10-15 are published, a single recap message in the general thread
(/t/10385) lists each of them with its version and capabilities.

## Decisions

- TCP through ser2net (38400 8N1), default port 4001 (4000 is the RFPlayer
  doc's): the Gladys sandbox has no USB/serial access.
- The RFXtrx protocol is **ported** from node-rfxcom (MIT notice kept), not
  used as a dependency: it requires `serialport` and native bindings, useless
  in a TCP-only container.
- Protocols: nothing ticked = keep what the RFXtrx has; ticked = set mode at
  every connection, never saved to its flash (limited write cycles).
- One device per emitter heard: sensors per packet type + subtype + id (an
  Oregon probe with wind and temperature is two devices); remotes per
  id/house code with one BUTTON feature per button heard; keyfobs are
  remotes, Security1 sensors are detectors.
- Opening sensor values follow Gladys (0 = open, 1 = closed). Motion and
  smoke go back to 0 after 90 s (the sensors never send the end).
- Battery = (level + 1) × 10 %, as the RFXtrx SDK grades it (0-9); a level
  above 9 means "no battery information" and creates no feature.
- Signal = RSSI 0-15 shown as 0-5 bars; `min_signal` only filters NEW
  emitters (the devices already offered are never filtered).
- Button presses go through publishStates (two identical presses are two
  events), the other values through publishChangedStates.
- Actuators: switch/light for every transmit protocol, dimmer for AC,
  HomeEasy EU and LightwaveRF, shutter for RFY/RFYEXT only. Orders are not
  confirmed by receivers: the state shown is the one sent.
- A remote heard with the address of a declared actuator moves its state
  (the user's own wall switch drives the same plug).
